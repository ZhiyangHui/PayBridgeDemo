import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "../config/env";
import { validateAlipayLoginCredentials } from "../config/credentials";
import { getDb } from "../db/client";
import { AppError } from "../errors/app-error";
import { errorResponse } from "../errors/response";
import { alipayAuthorizeUrl, exchangeAlipayCode } from "./alipay";
import { createMockCode, exchangeMockCode } from "./mock";
import { registerMockAccount, loginMockAccount } from "./mock-accounts";
import { cookieOptions, SESSION_COOKIE } from "./session";
import {
  completeLogin,
  checkLoginState,
  consumeLoginState,
  createLoginState,
  revokeSession,
  SESSION_SECONDS,
  STATE_SECONDS,
} from "./store";
import type { LoginProfile, LoginProvider } from "./types";

/**
 * 读取配置，判断指定渠道是否使用模拟登录。
 * 微信读取 WECHAT_MODE，支付宝读取独立的 ALIPAY_LOGIN_MODE。
 */
export function isMockLogin(provider: LoginProvider): boolean {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE === "mock" : env.ALIPAY_LOGIN_MODE === "mock";
}

/**
 * 检查请求的 Origin 是否与配置的 APP_URL 同源。
 * @throws AppError Origin 缺失或不匹配时抛出 FORBIDDEN。
 */
export function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("origin") !== new URL(getEnv().APP_URL).origin) {
    throw new AppError("FORBIDDEN");
  }
}

/**
 * 记录登录异常，并生成登录失败页的跳转响应。
 * 响应只带固定错误码和追踪编号，不携带授权码、令牌或平台错误正文。
 */
function loginFailure(cause: unknown) {
  const safe = errorResponse(cause);
  const code = cause instanceof AppError ? cause.code : "INTERNAL_ERROR";
  const url = new URL("/login-error", getEnv().APP_URL);
  url.searchParams.set("code", code);
  url.searchParams.set("ref", safe.headers.get("X-Request-Id")!);

  return NextResponse.redirect(url, 303);
}

/**
 * 创建一次登录请求，并跳转模拟登录页或支付宝授权页。
 * 保存授权 state 和浏览器绑定信息，将绑定值写入 Cookie。
 * @param sandbox 为 true 时单独发起支付宝沙箱 OAuth 授权。
 * @returns 登录页的重定向；配置或渠道不支持时跳到登录失败页。
 */
export async function startLogin(request: NextRequest, provider: LoginProvider, sandbox = false) {
  try {
    const env = getEnv();
    const path = sandbox ? "/api/auth/alipay/sandbox/start" : `/api/auth/${provider}/start`;
    const canonical = new URL(path, env.APP_URL);

    // 统一 localhost 和 127.0.0.1 等访问地址，防止回调丢失 Cookie。
    if (request.headers.get("host") !== canonical.host) {
      return NextResponse.redirect(canonical);
    }

    // 真实微信登录尚未实现；配置为真实模式时返回未接入错误。
    if (!isMockLogin(provider) && provider === "wechat") {
      throw new AppError("FEATURE_UNAVAILABLE");
    }

    if (sandbox && (provider !== "alipay" || env.PAYMENT_MODE === "live")) {
      throw new AppError("NOT_FOUND");
    }

    // 先确定这次登录的模式，再将模式与 state 一起保存。
    let mode: "mock" | "sandbox" | "live" = "mock";

    if (sandbox || !isMockLogin(provider)) {
      mode = env.PAYMENT_MODE === "live" ? "live" : "sandbox";
      validateAlipayLoginCredentials(process.env, mode === "sandbox");
    }

    const { state, browser } = await createLoginState(getDb(), provider, mode);
    const callback = new URL(`/api/auth/${provider}/callback`, env.APP_URL).toString();
    const destination =
      mode === "mock"
        ? new URL(`/mock/login/${provider}?state=${state}`, env.APP_URL).toString()
        : alipayAuthorizeUrl(state, callback, mode === "sandbox");
    const response = NextResponse.redirect(destination, 303);
    // 将浏览器绑定值写入 Cookie，回调必须同时带上它和正确的 state。
    response.cookies.set(`oauth_${provider}`, browser, cookieOptions(STATE_SECONDS));
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (cause) {
    return loginFailure(cause);
  }
}

/**
 * 处理平台授权回调，校验 state、换取用户资料并创建本站会话。
 * 使用数据库保存的授权模式选择模拟或支付宝换码流程。
 * @returns 成功时设置会话 Cookie 并跳转商店；失败时跳到登录失败页。
 */
export async function finishLogin(request: NextRequest, provider: LoginProvider) {
  try {
    const state = request.nextUrl.searchParams.get("state") ?? "";
    // 先验证并消费 state，重复回调不能再次换码或建立会话。
    const mode = await consumeLoginState(
      getDb(),
      provider,
      state,
      request.cookies.get(`oauth_${provider}`)?.value ?? "",
    );

    // 平台返回取消授权时结束登录，不继续读取授权码。
    if (request.nextUrl.searchParams.has("error")) {
      throw new AppError("OAUTH_DENIED");
    }

    const code = request.nextUrl.searchParams.get(provider === "alipay" ? "auth_code" : "code");

    if (!code || code.length > 4096) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    let profile: LoginProfile;

    // 按该次登录记录的模式换取资料，不能由回调参数指定登录方式。
    if (mode === "mock" && isMockLogin(provider)) {
      profile = exchangeMockCode(code, provider, state, getEnv().SESSION_SECRET);
    } else if (provider === "alipay" && (mode === "sandbox" || mode === "live")) {
      if (mode === "live" && getEnv().PAYMENT_MODE !== "live") {
        throw new AppError("OAUTH_STATE_INVALID");
      }

      validateAlipayLoginCredentials(process.env, mode === "sandbox");
      profile = await exchangeAlipayCode(code, mode);
    } else {
      throw new AppError("FEATURE_UNAVAILABLE");
    }

    // 资料验证通过后才写入用户和新会话，并撤销浏览器的旧会话。
    const token = await completeLogin(
      getDb(),
      provider,
      profile,
      request.cookies.get(SESSION_COOKIE)?.value,
    );
    const response = NextResponse.redirect(new URL("/dashboard", getEnv().APP_URL), 303);
    response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS));
    // 会话已建立，清除本次授权使用的浏览器绑定 Cookie。
    response.cookies.set(`oauth_${provider}`, "", cookieOptions(0));
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (cause) {
    return loginFailure(cause);
  }
}

/**
 * 处理模拟账号的注册或登录表单，成功后跳到共用登录回调。
 * 检查请求来源和浏览器绑定状态，验证账号后生成一分钟有效的模拟授权码。
 * @returns 账号输入错误时回到表单；其他错误进入登录失败页。
 */
export async function confirmMockLogin(request: NextRequest, provider: LoginProvider) {
  let state = "";
  let intent = "login";

  try {
    if (!isMockLogin(provider)) {
      throw new AppError("NOT_FOUND");
    }

    requireSameOrigin(request);
    const form = await request.formData();
    state = String(form.get("state") ?? "");
    intent = String(form.get("intent") ?? "login");
    // 提交注册或登录表单前校验 state，但先不消费，留给后续回调使用。
    const loginState = await checkLoginState(
      getDb(),
      provider,
      state,
      request.cookies.get(`oauth_${provider}`)?.value ?? "",
    );

    if (loginState.mode !== "mock") {
      throw new AppError("OAUTH_STATE_INVALID");
    }

    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    let profile: LoginProfile;

    // 注册和登录都返回相同的用户资料结构，后续共用模拟授权码流程。
    if (intent === "register") {
      profile = await registerMockAccount(
        getDb(),
        provider,
        username,
        password,
        String(form.get("balance") ?? "100.00"),
      );
    } else if (intent === "login") {
      profile = await loginMockAccount(getDb(), provider, username, password);
    } else {
      throw new AppError("INVALID_INPUT");
    }

    const callback = new URL(`/api/auth/${provider}/callback`, getEnv().APP_URL);
    callback.searchParams.set("state", state);
    callback.searchParams.set(
      provider === "alipay" ? "auth_code" : "code",
      createMockCode(provider, state, getEnv().SESSION_SECRET, profile),
    );

    return NextResponse.redirect(callback, 303);
  } catch (cause) {
    // 账号已存在、密码错误和输入错误允许返回表单重试；其他异常结束登录。
    const recoverable =
      cause instanceof AppError &&
      ["ACCOUNT_EXISTS", "LOGIN_FAILED", "INVALID_CREDENTIALS", "INVALID_AMOUNT"].includes(
        cause.code,
      );

    if (!recoverable) {
      return loginFailure(cause);
    }

    const url = new URL(`/mock/login/${provider}`, getEnv().APP_URL);
    url.searchParams.set("state", state);
    url.searchParams.set("tab", intent === "register" ? "register" : "login");
    url.searchParams.set("error", cause.code);

    return NextResponse.redirect(url, 303);
  }
}

/**
 * 撤销当前数据库会话，清除浏览器 Cookie 并跳回首页。
 * 先检查请求来源；重复退出不报错，异常由登录错误页面展示。
 */
export async function logout(request: NextRequest) {
  try {
    requireSameOrigin(request);
    await revokeSession(getDb(), request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.redirect(new URL("/", getEnv().APP_URL), 303);
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));

    return response;
  } catch (cause) {
    return loginFailure(cause);
  }
}

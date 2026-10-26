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

/** 根据服务端配置决定渠道是否模拟，客户端不能自行切换。 */
export function isMockLogin(provider: LoginProvider): boolean {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE === "mock" : env.PAYMENT_MODE === "mock";
}

/** POST 操作只接受配置站点发起的请求，防止跨站授权确认或退出。 */
export function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("origin") !== new URL(getEnv().APP_URL).origin) {
    throw new AppError("FORBIDDEN");
  }
}

/** 将登录错误带回可读页面，记录追踪 ID 而不暴露原始平台错误。 */
function loginFailure(cause: unknown) {
  const safe = errorResponse(cause);
  const code = cause instanceof AppError ? cause.code : "INTERNAL_ERROR";
  const url = new URL("/login-error", getEnv().APP_URL);
  url.searchParams.set("code", code);
  url.searchParams.set("ref", safe.headers.get("X-Request-Id")!);

  return NextResponse.redirect(url, 303);
}

/** 创建浏览器绑定的授权状态并跳转到对应平台。 */
export async function startLogin(request: NextRequest, provider: LoginProvider, sandbox = false) {
  try {
    const env = getEnv();
    const path = sandbox ? "/api/auth/alipay/sandbox/start" : `/api/auth/${provider}/start`;
    const canonical = new URL(path, env.APP_URL);

    // 统一 localhost 和 127.0.0.1 等访问地址，防止回调丢失 Cookie。
    if (request.headers.get("host") !== canonical.host) {
      return NextResponse.redirect(canonical);
    }

    if (!isMockLogin(provider) && provider === "wechat") {
      throw new AppError("FEATURE_UNAVAILABLE");
    }

    if (sandbox && (provider !== "alipay" || env.PAYMENT_MODE === "live")) {
      throw new AppError("NOT_FOUND");
    }

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
    response.cookies.set(`oauth_${provider}`, browser, cookieOptions(STATE_SECONDS));
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (cause) {
    return loginFailure(cause);
  }
}

/** 模拟与真实登录共用回调，先消费 state，再换码并创建会话。 */
export async function finishLogin(request: NextRequest, provider: LoginProvider) {
  try {
    const state = request.nextUrl.searchParams.get("state") ?? "";
    const mode = await consumeLoginState(
      getDb(),
      provider,
      state,
      request.cookies.get(`oauth_${provider}`)?.value ?? "",
    );

    if (request.nextUrl.searchParams.has("error")) {
      throw new AppError("OAUTH_DENIED");
    }

    const code = request.nextUrl.searchParams.get(provider === "alipay" ? "auth_code" : "code");

    if (!code || code.length > 4096) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    let profile: LoginProfile;

    if (mode === "mock" && isMockLogin(provider)) {
      profile = exchangeMockCode(code, provider, state, getEnv().SESSION_SECRET);
    } else if (provider === "alipay" && (mode === "sandbox" || mode === "live")) {
      if (mode === "live" && getEnv().PAYMENT_MODE !== "live") {
        throw new AppError("OAUTH_STATE_INVALID");
      }

      validateAlipayLoginCredentials(process.env, mode === "sandbox");
      profile = await exchangeAlipayCode(code);
    } else {
      throw new AppError("FEATURE_UNAVAILABLE");
    }

    const token = await completeLogin(
      getDb(),
      provider,
      profile,
      request.cookies.get(SESSION_COOKIE)?.value,
    );
    const response = NextResponse.redirect(new URL("/dashboard", getEnv().APP_URL), 303);
    response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS));
    response.cookies.set(`oauth_${provider}`, "", cookieOptions(0));
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (cause) {
    return loginFailure(cause);
  }
}

/** 模拟账号验证后签发短期码，最终仍由共用 callback 建立会话。 */
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

/** 撤销数据库会话后清除 Cookie，重复退出保持幂等。 */
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

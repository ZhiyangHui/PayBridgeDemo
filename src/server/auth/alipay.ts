import "server-only";
import { AlipaySdk } from "alipay-sdk";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { redactAlipayMessage } from "./alipay-diagnostics";
import type { LoginProfile } from "./types";

/** 仅接受经过 SDK 验签后且包含访问令牌的换码响应。 */
const tokenSchema = z.object({
  code: z.literal("10000").optional(),
  access_token: z.string().min(1),
  user_id: z.string().trim().min(1).optional(),
  open_id: z.string().trim().min(1).optional(),
});

/** v3 成功响应没有业务成功码；兼容返回 10000 的响应，身份仍需单独核对。 */
const profileSchema = z.object({
  code: z.literal("10000").optional(),
  user_id: z.string().trim().min(1).optional(),
  open_id: z.string().trim().min(1).optional(),
  nick_name: z.string().optional(),
  avatar: z.string().optional(),
});

/**
 * 生成支付宝 OAuth 授权地址。
 * @param state 本次登录的随机状态，用于回调时核对请求。
 * @param callback 本站接收支付宝授权结果的完整 URL。
 * @param sandbox 是否使用沙箱授权域名。
 * @returns 包含应用 ID、auth_user 权限、回调地址和 state 的授权 URL。
 */
export function alipayAuthorizeUrl(state: string, callback: string, sandbox: boolean): string {
  const url = new URL(
    sandbox
      ? "https://openauth-sandbox.dl.alipaydev.com/oauth2/publicAppAuthorize.htm"
      : "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm",
  );
  url.search = new URLSearchParams({
    app_id: process.env.ALIPAY_APP_ID!,
    scope: "auth_user",
    redirect_uri: callback,
    state,
  }).toString();

  return url.toString();
}

/**
 * 用支付宝授权码换取访问令牌，再查询用户资料。
 * 换码使用 v2，会员资料查询使用 v3；核对两次响应中的用户标识后返回资料。
 * @param code 本次授权得到的一次性授权码。
 * @param mode 本次登录环境；沙箱资料接口返回指定服务错误时，可使用默认昵称和空头像。
 * @returns 用户标识、昵称和可用的 HTTPS 头像地址，不保存或返回访问令牌。
 * @throws AppError 缺失或不一致的身份为 OAUTH_CODE_INVALID；平台请求、验签或解析异常为 OAUTH_PROVIDER_ERROR。
 */
export async function exchangeAlipayCode(
  code: string,
  mode: "sandbox" | "live" = "live",
): Promise<LoginProfile> {
  let stage: "token" | "profile" = "token";
  let response: unknown;
  let accessToken = "";
  let profileTraceId: string | undefined;

  try {
    const sdk = new AlipaySdk({
      appId: process.env.ALIPAY_APP_ID!,
      privateKey: process.env.ALIPAY_PRIVATE_KEY!,
      keyType: "PKCS8",
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
      gateway: process.env.ALIPAY_GATEWAY!,
      // curl 使用 endpoint，不读取 gateway；从同一配置取域名，避免沙箱误连正式环境。
      endpoint: new URL(process.env.ALIPAY_GATEWAY!).origin,
      signType: "RSA2",
      timeout: 8000,
      camelcase: false,
    });

    // 通过 v2 接口用一次性授权码换取访问令牌，请求失败时不重复使用该授权码。
    response = await sdk.exec(
      "alipay.system.oauth.token",
      { grantType: "authorization_code", code },
      { validateSign: true },
    );
    // 检查换码响应中是否存在访问令牌，以及可用的用户身份字段。
    const token = tokenSchema.parse(response);
    accessToken = token.access_token;
    // 正常和降级登录都使用换码响应中的身份，避免资料恢复后生成另一个账号。
    const providerUserId = token.user_id ?? token.open_id;

    // 没有用户标识就无法关联本站账号，立即终止登录。
    if (!providerUserId) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    stage = "profile";
    response = undefined;

    // 官方 v3 接口通过查询参数接收 auth_token；SDK 默认验证成功响应的签名。
    const result = await sdk.curl<unknown>("POST", "/v3/alipay/user/info/share", {
      query: { auth_token: token.access_token },
    });
    response = result.data;
    profileTraceId = safeTraceId(result.traceId);

    // 资料接口未返回 HTTP 200 时终止登录，不把服务异常视为授权成功。
    if (result.responseHttpStatus !== 200) {
      throw new AppError("OAUTH_PROVIDER_ERROR");
    }

    if (
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "20000"
    ) {
      // 仅对已验签的沙箱资料服务异常降级，权限、令牌和验签错误仍然拒绝登录。
      if (
        mode === "sandbox" &&
        "sub_code" in response &&
        response.sub_code === "aop.unknow-error"
      ) {
        console.warn(
          JSON.stringify({
            event: "alipay_profile_fallback",
            protocol: "v3",
            traceId: profileTraceId,
            reason: "provider_service_unavailable",
            code: "20000",
            sub_code: "aop.unknow-error",
          }),
        );

        return { providerUserId, nickname: "支付宝用户", avatar: null };
      }
    }

    // 解析资料字段，再核对资料身份与换码返回的身份是否一致。
    const user = profileSchema.parse(response);
    const profileUserId = token.user_id ? user.user_id : user.open_id;

    if (
      profileUserId !== providerUserId ||
      (token.open_id && user.open_id && token.open_id !== user.open_id)
    ) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    // 仅保留 HTTPS 头像地址，缺失或其他协议的地址按无头像处理。
    const avatar = user.avatar && /^https:\/\//.test(user.avatar) ? user.avatar : null;

    console.info(
      JSON.stringify({
        event: "alipay_profile_success",
        protocol: "v3",
        traceId: profileTraceId,
      }),
    );

    return { providerUserId, nickname: user.nick_name || "支付宝用户", avatar };
  } catch (cause) {
    // 已明确分类的业务错误原样抛出，其他异常记录诊断后统一包装。
    if (cause instanceof AppError) {
      throw cause;
    }

    logAlipayFailure(stage, cause, response, profileTraceId, [code, accessToken]);
    throw new AppError("OAUTH_PROVIDER_ERROR", undefined, { cause });
  }
}

/**
 * 从支付宝异常或响应中提取可公开记录的诊断字段，并写入错误日志。
 * 记录请求阶段、接口版本、HTTP 状态、错误类别、业务码和追踪号。
 * @param secrets 需要从诊断文本中移除的授权码和访问令牌。
 * 启用本地诊断时额外记录脱敏说明，不输出完整响应或密钥。
 */
function logAlipayFailure(
  stage: "token" | "profile",
  cause: unknown,
  response: unknown,
  profileTraceId: string | undefined,
  secrets: string[],
): void {
  const error = cause as {
    responseDataRaw?: unknown;
    message?: unknown;
    traceId?: unknown;
    code?: unknown;
    responseHttpStatus?: unknown;
  } | null;

  // 尝试从 SDK 保存的响应正文中读取业务错误；非 JSON 内容不写入日志。
  if (typeof error?.responseDataRaw === "string") {
    try {
      const raw = JSON.parse(error.responseDataRaw);
      response =
        raw.error_response ??
        raw[
          stage === "token"
            ? "alipay_system_oauth_token_response"
            : "alipay_user_info_share_response"
        ] ??
        raw;
    } catch {
      /* 非 JSON 响应只记录错误类别。 */
    }
  }

  const codes = z
    .object({
      code: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]{1,100}$/)
        .optional(),
      sub_code: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]{1,100}$/)
        .optional(),
      traceId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,128}$/)
        .optional(),
    })
    .safeParse(response ?? { code: error?.code });
  let category = "request";

  // 区分验签错误、平台业务错误和响应字段错误，方便定位失败阶段。
  if (typeof error?.message === "string" && error.message.includes("验签")) {
    category = "signature";
  } else if (codes.success && codes.data.code && codes.data.code !== "10000") {
    category = "provider_business";
  } else if (cause instanceof z.ZodError) {
    category = "response_schema";
  }

  const traceId = safeTraceId(error?.traceId) ?? profileTraceId;
  const status =
    typeof error?.responseHttpStatus === "number" ? error.responseHttpStatus : undefined;
  const detail =
    process.env.ALIPAY_DIAGNOSTICS === "1" && process.env.NODE_ENV !== "production"
      ? redactAlipayMessage(error?.message, [
          ...secrets,
          process.env.ALIPAY_PRIVATE_KEY ?? "",
          process.env.SESSION_SECRET ?? "",
        ])
      : undefined;
  console.error(
    JSON.stringify({
      event: "alipay_auth_failure",
      protocol: stage === "profile" ? "v3" : "v2",
      status,
      detail,
      stage,
      category,
      traceId,
      ...(codes.success ? codes.data : {}),
    }),
  );
}

/**
 * 检查平台追踪号是否只含字母、数字、下划线或连字符，且不超过 128 位。
 * @returns 合法的追踪号；类型或格式不符合要求时返回 undefined。
 */
function safeTraceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

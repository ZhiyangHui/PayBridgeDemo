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

/** 构造支付宝授权地址；沙箱地址与真实网关分别配置。 */
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

/** 服务端换取令牌并读取资料；不保存令牌、不重试一次性授权码。 */
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

    // 保留已跑通的 v2 换码，只切换故障所在的资料查询；授权码不重试。
    response = await sdk.exec(
      "alipay.system.oauth.token",
      { grantType: "authorization_code", code },
      { validateSign: true },
    );
    const token = tokenSchema.parse(response);
    accessToken = token.access_token;
    // 正常和降级登录都使用换码响应中的身份，避免资料恢复后生成另一个账号。
    const providerUserId = token.user_id ?? token.open_id;

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

    const user = profileSchema.parse(response);
    const profileUserId = token.user_id ? user.user_id : user.open_id;

    if (
      profileUserId !== providerUserId ||
      (token.open_id && user.open_id && token.open_id !== user.open_id)
    ) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

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
    if (cause instanceof AppError) {
      throw cause;
    }

    logAlipayFailure(stage, cause, response, profileTraceId, [code, accessToken]);
    throw new AppError("OAUTH_PROVIDER_ERROR", undefined, { cause });
  }
}

/** 只记录阶段、错误类别和平台错误码，禁止输出响应正文或令牌。 */
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

/** 平台追踪号只保留允许的字符，不把异常正文当作日志字段。 */
function safeTraceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

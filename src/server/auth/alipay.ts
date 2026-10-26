import "server-only";
import { AlipaySdk } from "alipay-sdk";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { diagnoseAlipayProfile } from "./alipay-diagnostics";
import type { LoginProfile } from "./types";

/** 仅接受经过 SDK 验签后且包含访问令牌的换码响应。 */
const tokenSchema = z.object({
  access_token: z.string().min(1),
  user_id: z.string().optional(),
  open_id: z.string().optional(),
});

/** 用户信息需包含成功状态和稳定身份，缺省昵称可使用平台名称。 */
const profileSchema = z.object({
  code: z.literal("10000"),
  user_id: z.string().optional(),
  open_id: z.string().optional(),
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
export async function exchangeAlipayCode(code: string): Promise<LoginProfile> {
  let stage: "token" | "profile" = "token";
  let response: unknown;

  try {
    const sdk = new AlipaySdk({
      appId: process.env.ALIPAY_APP_ID!,
      privateKey: process.env.ALIPAY_PRIVATE_KEY!,
      keyType: "PKCS8",
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
      gateway: process.env.ALIPAY_GATEWAY!,
      signType: "RSA2",
      timeout: 8000,
      camelcase: false,
    });

    // 官方会员沙箱指南使用 v2 网关协议；PKCS8 与本地密钥格式一致，每次响应都验签。
    response = await sdk.exec(
      "alipay.system.oauth.token",
      { grantType: "authorization_code", code },
      { validateSign: true },
    );
    const token = tokenSchema.parse(response);

    stage = "profile";
    response = undefined;

    response = await sdk.exec(
      "alipay.user.info.share",
      { authToken: token.access_token },
      { validateSign: true },
    );

    if (
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === "20000"
    ) {
      await diagnoseAlipayProfile(sdk, token.access_token, code, response);
    }

    const user = profileSchema.parse(response);
    const providerUserId = user.user_id ?? user.open_id;
    const tokenUserId = user.user_id ? token.user_id : token.open_id;

    if (!providerUserId || (tokenUserId && tokenUserId !== providerUserId)) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    const avatar = user.avatar && /^https:\/\//.test(user.avatar) ? user.avatar : null;

    return { providerUserId, nickname: user.nick_name || "支付宝用户", avatar };
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }

    logAlipayFailure(stage, cause, response);
    throw new AppError("OAUTH_PROVIDER_ERROR", undefined, { cause });
  }
}

/** 只记录阶段、错误类别和平台错误码，禁止输出响应正文或令牌。 */
function logAlipayFailure(stage: "token" | "profile", cause: unknown, response: unknown): void {
  const error = cause as { responseDataRaw?: unknown; message?: unknown; traceId?: unknown } | null;

  if (typeof error?.responseDataRaw === "string") {
    try {
      const raw = JSON.parse(error.responseDataRaw);
      response =
        raw.error_response ??
        raw[
          stage === "token"
            ? "alipay_system_oauth_token_response"
            : "alipay_user_info_share_response"
        ];
    } catch {
      /* 非 JSON 响应只记录错误类别。 */
    }
  }

  const codes = z
    .object({
      code: z
        .string()
        .regex(/^\d{5}$/)
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
    .safeParse(response);
  let category = "request";

  if (typeof error?.message === "string" && error.message.includes("验签")) {
    category = "signature";
  } else if (codes.success && codes.data.code && codes.data.code !== "10000") {
    category = "provider_business";
  } else if (cause instanceof z.ZodError) {
    category = "response_schema";
  }

  const traceId =
    typeof error?.traceId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(error.traceId)
      ? error.traceId
      : undefined;
  console.error(
    JSON.stringify({
      event: "alipay_auth_failure",
      stage,
      category,
      traceId,
      ...(codes.success ? codes.data : {}),
    }),
  );
}

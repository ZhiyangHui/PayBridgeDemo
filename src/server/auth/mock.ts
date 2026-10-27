import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import type { LoginProvider, LoginProfile } from "./types";

/** 模拟授权码绑定 state、渠道和有效期，不接受客户端传来的用户资料。 */
const payloadSchema = z.object({
  provider: z.enum(["wechat", "alipay"]),
  state: z.string(),
  expires: z.number(),
  profile: z.object({
    providerUserId: z.string().startsWith("mock_").max(80),
    nickname: z.string().min(3).max(24),
    avatar: z.enum(["/avatars/wechat.svg", "/avatars/alipay.svg"]),
  }),
});

/**
 * 将模拟用户资料、登录渠道和 state 编码成短期授权码。
 * 授权码由 Base64URL 载荷和 HMAC-SHA256 签名组成，有效期为一分钟。
 * @param secret 服务端会话密钥，用于生成签名。
 * @returns 可传给本站登录回调的模拟授权码。
 */
export function createMockCode(
  provider: LoginProvider,
  state: string,
  secret: string,
  profile: LoginProfile,
): string {
  const payload = Buffer.from(
    JSON.stringify({ provider, state, profile, expires: Date.now() + 60_000 }),
  ).toString("base64url");

  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

/**
 * 验证模拟授权码并提取用户资料。
 * 依次检查格式、HMAC 签名、载荷结构、登录渠道、state 和过期时间。
 * @returns 验证通过的模拟用户身份、昵称和头像。
 * @throws AppError 任意验证失败时抛出 OAUTH_CODE_INVALID。
 */
export function exchangeMockCode(
  code: string,
  provider: LoginProvider,
  state: string,
  secret: string,
): LoginProfile {
  // 授权码必须恰好包含载荷和签名两段。
  const [payload, signature, extra] = code.split(".");

  if (!payload || extra || !/^[a-f0-9]{64}$/.test(signature ?? "")) {
    throw new AppError("OAUTH_CODE_INVALID");
  }

  // 用服务端密钥重新计算签名，再进行等时比较。
  const expected = createHmac("sha256", secret).update(payload).digest();

  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    throw new AppError("OAUTH_CODE_INVALID");
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch (cause) {
    throw new AppError("OAUTH_CODE_INVALID", undefined, { cause });
  }

  // 签名通过后再检查载荷内容是否属于这次登录，并确认尚未过期。
  const parsed = payloadSchema.safeParse(decoded);

  if (
    !parsed.success ||
    parsed.data.provider !== provider ||
    parsed.data.state !== state ||
    parsed.data.expires <= Date.now()
  ) {
    throw new AppError("OAUTH_CODE_INVALID");
  }

  return parsed.data.profile;
}

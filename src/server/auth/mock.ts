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

/** 签发仅用于模拟回调的短期授权码。 */
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

/** 验证模拟码签名和绑定关系，返回所选测试身份。 */
export function exchangeMockCode(
  code: string,
  provider: LoginProvider,
  state: string,
  secret: string,
): LoginProfile {
  const [payload, signature, extra] = code.split(".");

  if (!payload || extra || !/^[a-f0-9]{64}$/.test(signature ?? "")) {
    throw new AppError("OAUTH_CODE_INVALID");
  }

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

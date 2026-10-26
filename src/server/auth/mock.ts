import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import type { LoginProvider, LoginProfile } from "./types";

/** 模拟授权码绑定 state、渠道和有效期，不接受客户端传来的用户资料。 */
const payloadSchema = z.object({
  provider: z.enum(["wechat", "alipay"]),
  state: z.string(),
  expires: z.number(),
});

/** 签发仅用于模拟回调的短期授权码。 */
export function createMockCode(provider: LoginProvider, state: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ provider, state, expires: Date.now() + 60_000 }),
  ).toString("base64url");

  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

/** 验证模拟码签名和绑定关系，返回固定测试身份。 */
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

  const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));

  if (
    !parsed.success ||
    parsed.data.provider !== provider ||
    parsed.data.state !== state ||
    parsed.data.expires <= Date.now()
  ) {
    throw new AppError("OAUTH_CODE_INVALID");
  }

  return {
    providerUserId: `mock-${provider}-user`,
    nickname: provider === "wechat" ? "微信测试用户" : "支付宝测试用户",
    avatar: `/avatars/${provider}.svg`,
  };
}

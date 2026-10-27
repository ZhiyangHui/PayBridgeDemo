import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createMockCode, exchangeMockCode } from "../../lib/auth/mock";

const secret = "test-secret".repeat(4);
const profile = {
  providerUserId: "mock_registered",
  nickname: "alice",
  avatar: "/avatars/wechat.svg",
};

afterEach(() => vi.useRealTimers());

describe("模拟授权码", () => {
  it("返回服务端验证后签发的账号资料", () => {
    const code = createMockCode("wechat", "state", secret, profile);
    expect(exchangeMockCode(code, "wechat", "state", secret)).toEqual(profile);
  });

  it("拒绝篡改账号、伪造签名、跨渠道、跨 state 和过期码", () => {
    const code = createMockCode("wechat", "state", secret, profile);
    const [payload, signature] = code.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.profile.providerUserId = "mock_other";
    const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url") + "." + signature;
    expect(() => exchangeMockCode(forged, "wechat", "state", secret)).toThrow();
    expect(() => exchangeMockCode(code + "0", "wechat", "state", secret)).toThrow();
    expect(() => exchangeMockCode(code, "alipay", "state", secret)).toThrow();
    expect(() => exchangeMockCode(code, "wechat", "other", secret)).toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(() => exchangeMockCode(code, "wechat", "state", secret)).toThrow();
  });

  it("签名正确但格式损坏的载荷返回授权码错误", () => {
    const payload = Buffer.from("invalid-json").toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    expect(() => exchangeMockCode(`${payload}.${signature}`, "wechat", "state", secret)).toThrow(
      expect.objectContaining({ code: "OAUTH_CODE_INVALID" }),
    );
  });
});

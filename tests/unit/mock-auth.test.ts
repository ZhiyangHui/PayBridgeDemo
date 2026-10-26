import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockCode, exchangeMockCode } from "../../src/server/auth/mock";

const secret = "test-secret".repeat(4);

afterEach(() => vi.useRealTimers());

describe("模拟授权码", () => {
  it("接受签名且绑定当前 state 的授权码", () => {
    const code = createMockCode("wechat", "state", secret);
    expect(exchangeMockCode(code, "wechat", "state", secret).providerUserId).toBe(
      "mock-wechat-user",
    );
  });
  it("拒绝伪造签名、跨渠道、跨 state 和过期码", () => {
    const code = createMockCode("wechat", "state", secret);
    expect(() => exchangeMockCode(code + "0", "wechat", "state", secret)).toThrow();
    expect(() => exchangeMockCode(code, "alipay", "state", secret)).toThrow();
    expect(() => exchangeMockCode(code, "wechat", "other", secret)).toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(() => exchangeMockCode(code, "wechat", "state", secret)).toThrow();
  });
});

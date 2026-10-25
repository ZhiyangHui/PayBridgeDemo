import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/server/config/env";
const base = { APP_URL: "http://localhost:3000", DATABASE_URL: "file:./dev.db", PAYMENT_MODE: "mock", SESSION_SECRET: "x".repeat(32) };
describe("运行模式配置", () => {
  it("模拟模式不要求真实平台凭据", () => expect(parseEnv(base).PAYMENT_MODE).toBe("mock"));
  it("沙箱缺少支付宝凭据时拒绝启动", () => expect(() => parseEnv({ ...base, PAYMENT_MODE: "sandbox" })).toThrow("ALIPAY_APP_ID"));
  it("错误中不泄露输入值", () => expect(() => parseEnv({ ...base, APP_URL: "secret-value" })).toThrow(/^环境配置有误：APP_URL$/));
  it("正式环境拒绝示例会话密钥", () => expect(() => parseEnv({ ...base, PAYMENT_MODE: "live", SESSION_SECRET: "replace-with-32-plus-random-chars-here" })).toThrow("SESSION_SECRET"));
});

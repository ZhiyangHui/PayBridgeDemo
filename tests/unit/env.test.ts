import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { parseEnv } from "../../src/server/config/env";
import { validateCredentials } from "../../src/server/config/credentials";
const base = { APP_URL: "http://localhost:3000", DATABASE_URL: "file:./dev.db", PAYMENT_MODE: "mock", SESSION_SECRET: "x".repeat(32) };
const sandbox = { ...base, PAYMENT_MODE: "sandbox", ALIPAY_APP_ID: "123", ALIPAY_PRIVATE_KEY: "invalid", ALIPAY_PUBLIC_KEY: "invalid", ALIPAY_GATEWAY: "https://openapi-sandbox.dl.alipaydev.com/gateway.do", ALIPAY_NOTIFY_URL: "https://demo.test/notify", ALIPAY_RETURN_URL: "https://demo.test/orders" };

describe("运行模式配置", () => {
  it("mock 不读取真实凭据并强制微信模拟", () => {
    expect(parseEnv({ ...base, WECHAT_MODE: "live" }).WECHAT_MODE).toBe("mock");
    expect(() => validateCredentials(base)).not.toThrow();
  });
  it("sandbox 允许微信模拟，要求支付宝凭据", () => {
    expect(parseEnv(sandbox).WECHAT_MODE).toBe("mock");
    expect(() => parseEnv({ ...base, PAYMENT_MODE: "sandbox" })).toThrow("ALIPAY_APP_ID");
  });
  it("错误中不泄露输入值", () => expect(() => parseEnv({ ...base, APP_URL: "secret-value" })).toThrow(/^环境配置有误：APP_URL$/));
  it("拒绝占位会话密钥", () => expect(() => parseEnv({ ...base, SESSION_SECRET: "replace-with-32-plus-random-chars-here" })).toThrow("SESSION_SECRET"));
  it("拒绝占位平台凭据", () => expect(() => parseEnv({ ...sandbox, ALIPAY_APP_ID: "your-app-id" })).toThrow("ALIPAY_APP_ID"));
  it("沙箱不能指向正式网关", () => expect(() => parseEnv({ ...sandbox, ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do" })).toThrow("ALIPAY_GATEWAY"));
  it("正式模式不能指向沙箱或忽略微信配置", () => {
    expect(() => parseEnv({ ...sandbox, PAYMENT_MODE: "live" })).toThrow("ALIPAY_GATEWAY");
    expect(() => parseEnv({ ...sandbox, PAYMENT_MODE: "live" })).toThrow("WECHAT_APP_ID");
  });
  it("拒绝不安全或含密码的回调", () => {
    for (const url of ["http://demo.test/notify", "https://user:secret@demo.test/notify"]) {
      expect(() => parseEnv({ ...sandbox, ALIPAY_NOTIFY_URL: url })).toThrow("ALIPAY_NOTIFY_URL");
    }
  });
  it("非法密钥启动失败且不打印密钥", () => expect(() => validateCredentials(sandbox)).toThrow(/^密钥配置有误：ALIPAY_PRIVATE_KEY$/));
  it("接受有效 RSA 密钥", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => validateCredentials({ ...sandbox, ALIPAY_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), ALIPAY_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString() })).not.toThrow();
  });
});

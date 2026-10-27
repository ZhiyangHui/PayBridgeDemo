import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { parseEnv } from "../../src/server/config/env";
import { validateCredentials } from "../../src/server/config/credentials";

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "file:./dev.db",
  PAYMENT_MODE: "mock",
  SESSION_SECRET: "x".repeat(32),
};
const sandbox = {
  ...base,
  PAYMENT_MODE: "sandbox",
  ALIPAY_APP_ID: "123",
  ALIPAY_SELLER_ID: "2088000000000001",
  ALIPAY_PRIVATE_KEY: "invalid",
  ALIPAY_PUBLIC_KEY: "invalid",
  ALIPAY_GATEWAY: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
  ALIPAY_NOTIFY_URL: "https://demo.test/notify",
  ALIPAY_RETURN_URL: "https://demo.test/orders",
};

describe("运行模式配置", () => {
  it("mock 不读取真实凭据并强制微信模拟", () => {
    expect(parseEnv({ ...base, WECHAT_MODE: "live" }).WECHAT_MODE).toBe("mock");
    expect(() => validateCredentials(base)).not.toThrow();
  });
  it("sandbox 允许微信模拟，要求支付宝凭据", () => {
    expect(parseEnv(sandbox).WECHAT_MODE).toBe("mock");
    expect(() => parseEnv({ ...base, PAYMENT_MODE: "sandbox" })).toThrow("ALIPAY_APP_ID");
  });
  it("错误中不泄露输入值", () =>
    expect(() => parseEnv({ ...base, APP_URL: "secret-value" })).toThrow(
      /^环境配置有误：APP_URL$/,
    ));
  it("拒绝占位会话密钥", () =>
    expect(() =>
      parseEnv({ ...base, SESSION_SECRET: "replace-with-32-plus-random-chars-here" }),
    ).toThrow("SESSION_SECRET"));
  it("拒绝占位平台凭据", () =>
    expect(() => parseEnv({ ...sandbox, ALIPAY_APP_ID: "your-app-id" })).toThrow("ALIPAY_APP_ID"));
  it("沙箱不能指向正式网关", () =>
    expect(() =>
      parseEnv({ ...sandbox, ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do" }),
    ).toThrow("ALIPAY_GATEWAY"));
  it("正式模式不能指向沙箱或忽略微信配置", () => {
    expect(() => parseEnv({ ...sandbox, PAYMENT_MODE: "live" })).toThrow("ALIPAY_GATEWAY");
    expect(() => parseEnv({ ...sandbox, PAYMENT_MODE: "live" })).toThrow("WECHAT_APP_ID");
  });
  it("拒绝不安全或含密码的回调", () => {
    for (const url of ["http://demo.test/notify", "https://user:secret@demo.test/notify"]) {
      expect(() => parseEnv({ ...sandbox, ALIPAY_NOTIFY_URL: url })).toThrow("ALIPAY_NOTIFY_URL");
    }
  });
  it("非法密钥启动失败且不打印密钥", () =>
    expect(() => validateCredentials(sandbox)).toThrow(/^密钥配置有误：ALIPAY_PRIVATE_KEY$/));
  it("接受有效 RSA 密钥", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      validateCredentials({
        ...sandbox,
        ALIPAY_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        ALIPAY_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      }),
    ).not.toThrow();
  });
});

it("沙箱支付允许独立使用模拟登录，正式模式禁止", () => {
  expect(parseEnv({ ...sandbox, ALIPAY_LOGIN_MODE: "mock" }).ALIPAY_LOGIN_MODE).toBe("mock");
  expect(parseEnv({ ...base, ALIPAY_LOGIN_MODE: "" }).ALIPAY_LOGIN_MODE).toBe("mock");
  expect(() => parseEnv({ ...sandbox, PAYMENT_MODE: "live", ALIPAY_LOGIN_MODE: "mock" })).toThrow(
    "ALIPAY_LOGIN_MODE",
  );
});

/** 微信真实模式的测试配置，全部为占位测试值，不使用商户实际密钥。 */
const wechatLive = {
  ...sandbox,
  APP_URL: "https://shop.test",
  WECHAT_MODE: "live",
  WECHAT_APP_ID: "wx1234567890abcdef",
  WECHAT_APP_SECRET: "a".repeat(32),
  WECHAT_PAY_APP_ID: "wxabcdef1234567890",
  WECHAT_PAY_MCH_ID: "1900000001",
  WECHAT_PAY_API_V3_KEY: "b".repeat(32),
  WECHAT_PAY_CERT_SERIAL_NO: "AB".repeat(20),
  WECHAT_PAY_PLATFORM_KEY_ID: "PUB_KEY_ID_TEST",
  WECHAT_PAY_PRIVATE_KEY_PATH: "./certs/apiclient_key.pem",
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: "./certs/wechatpay_public_key.pem",
  WECHAT_PAY_NOTIFY_URL: "https://shop.test/api/pay/wechat/notify",
};

it("支付宝沙箱和微信真实模式可同时启用，登录和支付 AppID 可以不同", () => {
  expect(parseEnv(wechatLive).WECHAT_MODE).toBe("live");
});

it.each([
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_CERT_SERIAL_NO",
  "WECHAT_PAY_PLATFORM_KEY_ID",
])("微信真实模式检查必填字段 %s", (field) => {
  expect(() => parseEnv({ ...wechatLive, [field]: "" })).toThrow(field);
});

it("微信真实模式要求 HTTPS 站点和通知地址", () => {
  expect(() => parseEnv({ ...wechatLive, APP_URL: "http://localhost:3000" })).toThrow("APP_URL");
  expect(() =>
    parseEnv({ ...wechatLive, WECHAT_PAY_NOTIFY_URL: "http://localhost:3000/notify" }),
  ).toThrow("WECHAT_PAY_NOTIFY_URL");
});

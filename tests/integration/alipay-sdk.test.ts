import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
import { appendFileSync } from "node:fs";
import { exchangeAlipayCode } from "../../src/server/auth/alipay";

const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
let server: Server;
let calls: URLSearchParams[];
let queries: string[];
let profileFails = false;
let corruptSignature = false;

/** 使用本地签名响应验证真实 SDK 的请求编码和响应验签，不访问支付宝。 */

beforeEach(async () => {
  calls = [];
  queries = [];
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "0");
  vi.stubEnv("PAYMENT_MODE", "sandbox");
  vi.mocked(appendFileSync).mockClear();
  profileFails = false;
  corruptSignature = false;
  server = createServer(async (request, response) => {
    let body = "";

    for await (const chunk of request) {
      body += chunk;
    }

    queries.push(new URL(request.url!, "http://localhost").search);
    const params = new URL(request.url!, "http://localhost").searchParams;
    new URLSearchParams(body).forEach((value, key) => params.set(key, value));
    calls.push(params);
    const tokenRequest = params.get("method") === "alipay.system.oauth.token";
    const key = tokenRequest
      ? "alipay_system_oauth_token_response"
      : "alipay_user_info_share_response";
    let data: Record<string, string>;

    if (tokenRequest) {
      data = {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        user_id: "123",
      };
    } else if (profileFails) {
      data = { code: "20000", sub_code: "aop.unknow-error", sub_msg: "系统异常 test-access-token" };
    } else {
      data = { code: "10000", user_id: "123", nick_name: "测试用户" };
    }

    const signature = sign(
      "RSA-SHA256",
      Buffer.from(JSON.stringify(data)),
      corruptSignature ? appKeys.privateKey : platformKeys.privateKey,
    ).toString("base64");
    response.setHeader("trace_id", "test-platform-trace");
    response.end(JSON.stringify({ [key]: data, sign: signature }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("测试服务器未启动");
  }

  vi.stubEnv("ALIPAY_APP_ID", "test-app");
  vi.stubEnv(
    "ALIPAY_PRIVATE_KEY",
    appKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  vi.stubEnv(
    "ALIPAY_PUBLIC_KEY",
    platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  vi.stubEnv("ALIPAY_GATEWAY", `http://127.0.0.1:${address.port}/gateway.do`);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("支付宝真实 SDK 请求链", () => {
  it("使用 PKCS8 私钥签名，并将 access_token 作为顶层 auth_token 发送", async () => {
    expect(await exchangeAlipayCode("test-auth-code")).toEqual({
      providerUserId: "123",
      nickname: "测试用户",
      avatar: null,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].get("grant_type")).toBe("authorization_code");
    expect(calls[0].get("code")).toBe("test-auth-code");
    expect(calls[1].get("auth_token")).toBe("test-access-token");
    expect(calls[1].has("authToken")).toBe(false);
    expect(calls[1].has("app_auth_token")).toBe(false);
    expect(calls[1].has("biz_content")).toBe(false);

    for (const params of calls) {
      const content = [...params.entries()]
        .filter(([key]) => key !== "sign")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      expect(
        verify(
          "RSA-SHA256",
          Buffer.from(content),
          appKeys.publicKey,
          Buffer.from(params.get("sign")!, "base64"),
        ),
      ).toBe(true);
    }
  });
  it("资料业务失败保留平台追踪号，不返回用户、不重复消费授权码", async () => {
    profileFails = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(exchangeAlipayCode("test-auth-code")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      stage: "profile",
      category: "provider_business",
      code: "20000",
      traceId: "test-platform-trace",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-access-token");
  });
  it("拒绝伪造签名，换码响应未验签通过时不查询资料", async () => {
    corruptSignature = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(exchangeAlipayCode("test-auth-code")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(calls).toHaveLength(1);
  });
});

it("诊断只增加一次同令牌查询，保持验签并写入脱敏日志", async () => {
  profileFails = true;
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(exchangeAlipayCode("test-auth-code")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(calls).toHaveLength(3);
  expect(calls.filter((p) => p.get("method") === "alipay.system.oauth.token")).toHaveLength(1);
  expect(calls[2].get("auth_token")).toBe("test-access-token");
  expect(queries[2]).toBe("");
  const records = vi.mocked(appendFileSync).mock.calls.map((args) => JSON.parse(String(args[1])));
  expect(records).toHaveLength(2);
  expect(records.map((r) => r.transport)).toEqual(["sdk", "form"]);
  expect(records.every((r) => r.verified && r.code === "20000")).toBe(true);
  expect(records[0].runId).toBe(records[1].runId);
  expect(JSON.stringify(records)).not.toContain("test-access-token");
  expect(JSON.stringify(records)).not.toContain("test-auth-code");
});

it.each(["live", "mock"])("%s 模式不执行额外诊断", async (mode) => {
  profileFails = true;
  vi.stubEnv("PAYMENT_MODE", mode);
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(exchangeAlipayCode("test-auth-code")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(calls).toHaveLength(2);
  expect(appendFileSync).not.toHaveBeenCalled();
});

it("生产运行即使配置沙箱也不启用诊断", async () => {
  profileFails = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(exchangeAlipayCode("test-auth-code")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(calls).toHaveLength(2);
  expect(appendFileSync).not.toHaveBeenCalled();
});

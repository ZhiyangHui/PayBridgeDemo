import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { exchangeAlipayCode } from "../../lib/auth/alipay";

const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** 记录本地网关收到的请求，用真实 SDK 验证 v2 换码与 v3 资料查询。 */
type CapturedRequest = {
  path: string;
  method: string;
  params: URLSearchParams;
  validSignature: boolean;
};
let server: Server;
let calls: CapturedRequest[];
let profileStatus: number;
let profileData: Record<string, unknown>;
let corruptTokenSignature: boolean;
let profileSignature: "valid" | "invalid" | "missing";

beforeEach(async () => {
  calls = [];
  profileStatus = 200;
  profileData = { user_id: "123", nick_name: "测试用户" };
  corruptTokenSignature = false;
  profileSignature = "valid";
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "0");
  vi.stubEnv("PAYMENT_MODE", "mock");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  server = createServer(async (request, response) => {
    let body = "";

    for await (const chunk of request) {
      body += chunk;
    }

    const url = new URL(request.url!, "http://localhost");
    const params = url.searchParams;
    const isV3 = url.pathname === "/v3/alipay/user/info/share";
    let content: string;
    let signature: string;

    if (isV3) {
      const authorization = request.headers.authorization ?? "";
      const [auth, signed] = authorization.replace("ALIPAY-SHA256withRSA ", "").split(",sign=");
      content = `${auth}\n${request.method}\n${request.url}\n${body}\n`;
      signature = signed ?? "";
    } else {
      new URLSearchParams(body).forEach((value, key) => params.set(key, value));
      content = [...params.entries()]
        .filter(([key]) => key !== "sign")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      signature = params.get("sign") ?? "";
    }

    calls.push({
      path: url.pathname,
      method: request.method!,
      params,
      validSignature: verify(
        "RSA-SHA256",
        Buffer.from(content),
        appKeys.publicKey,
        Buffer.from(signature, "base64"),
      ),
    });
    response.setHeader("Content-Type", "application/json");

    if (isV3) {
      const raw = JSON.stringify(profileData);
      const timestamp = String(Date.now());
      const nonce = "test-response-nonce";
      response.statusCode = profileStatus;
      response.setHeader("alipay-trace-id", "test-v3-trace");
      response.setHeader("alipay-timestamp", timestamp);
      response.setHeader("alipay-nonce", nonce);

      if (profileSignature !== "missing") {
        response.setHeader(
          "alipay-signature",
          sign(
            "RSA-SHA256",
            Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
            profileSignature === "invalid" ? appKeys.privateKey : platformKeys.privateKey,
          ).toString("base64"),
        );
      }

      response.end(raw);

      return;
    }

    // 保留旧资料接口的故障，让测试能区分是否真正切到了 v3。
    const tokenRequest = params.get("method") === "alipay.system.oauth.token";
    const key = tokenRequest
      ? "alipay_system_oauth_token_response"
      : "alipay_user_info_share_response";
    const data = tokenRequest
      ? { access_token: "test-access-token", user_id: "123" }
      : { code: "20000", sub_code: "aop.unknow-error" };
    response.setHeader("trace_id", "test-v2-trace");
    response.end(
      JSON.stringify({
        [key]: data,
        sign: sign(
          "RSA-SHA256",
          Buffer.from(JSON.stringify(data)),
          corruptTokenSignature ? appKeys.privateKey : platformKeys.privateKey,
        ).toString("base64"),
      }),
    );
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

describe("支付宝 v3 资料查询", () => {
  it("旧接口故障时改用 v3，验签后返回真实资料且只换码一次", async () => {
    expect(await exchangeAlipayCode("test-auth-code", "sandbox")).toEqual({
      providerUserId: "123",
      nickname: "测试用户",
      avatar: null,
    });
    expect(calls.map((call) => call.path)).toEqual(["/gateway.do", "/v3/alipay/user/info/share"]);
    expect(calls.every((call) => call.method === "POST" && call.validSignature)).toBe(true);
    expect(calls[0].params.get("code")).toBe("test-auth-code");
    expect(calls[0].params.get("grant_type")).toBe("authorization_code");
    expect(calls[1].params.get("auth_token")).toBe("test-access-token");
    expect(calls[1].params.has("app_auth_token")).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({
      event: "alipay_profile_success",
      protocol: "v3",
      traceId: "test-v3-trace",
    });
  });

  it.each(["invalid", "missing"] as const)("资料响应签名 %s 时拒绝登录", async (signature) => {
    profileSignature = signature;
    await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(console.warn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it("换码验签失败时不查询资料", async () => {
    corruptTokenSignature = true;
    await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(calls).toHaveLength(1);
  });

  it.each([401, 403, 500])("HTTP %s 不伪装成功，记录 v3 错误码且不重复请求", async (status) => {
    profileStatus = status;
    profileData = { code: "system-error", message: "test-access-token secret" };
    profileSignature = "missing";
    await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(calls).toHaveLength(2);
    expect(console.warn).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      stage: "profile",
      protocol: "v3",
      status,
      code: "system-error",
      traceId: "test-v3-trace",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("test-access-token");
  });

  it.each([{}, { user_id: "other" }])("空资料或身份不一致不能当作成功：%j", async (data) => {
    profileData = data;
    await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
      code: "OAUTH_CODE_INVALID",
    });
    expect(console.info).not.toHaveBeenCalled();
  });

  it("仅沙箱允许已验签的旧格式系统错误降级", async () => {
    profileData = { code: "20000", sub_code: "aop.unknow-error" };
    expect(await exchangeAlipayCode("code", "sandbox")).toEqual({
      providerUserId: "123",
      nickname: "支付宝用户",
      avatar: null,
    });
    await expect(exchangeAlipayCode("new-code", "live")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
  });

  it("诊断开关不再额外发送旧协议查询", async () => {
    vi.stubEnv("ALIPAY_DIAGNOSTICS", "1");
    vi.stubEnv("PAYMENT_MODE", "sandbox");
    await exchangeAlipayCode("code", "sandbox");
    expect(calls).toHaveLength(2);
  });
});

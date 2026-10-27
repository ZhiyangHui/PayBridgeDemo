import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("alipay-sdk", () => ({
  AlipaySdk: class {
    exec = execute;

    /** 模拟 SDK 已验签的 v3 返回外壳；签名细节由真实 SDK 集成测试覆盖。 */
    async curl(...args: unknown[]) {
      return { data: await execute(...args), responseHttpStatus: 200, traceId: "unit-trace" };
    }
  },
}));
import { exchangeAlipayCode } from "../../lib/auth/alipay";

beforeEach(() => {
  execute.mockReset();
  vi.stubEnv("ALIPAY_GATEWAY", "https://openapi-sandbox.dl.alipaydev.com/gateway.do");
  vi.stubEnv("ALIPAY_DIAGNOSTICS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("支付宝资料适配", () => {
  it("服务端换码并开启两次响应验签", async () => {
    execute
      .mockResolvedValueOnce({ access_token: "secret", user_id: "123" })
      .mockResolvedValueOnce({
        code: "10000",
        user_id: "123",
        nick_name: "用户",
        avatar: "https://example.com/avatar.png",
      });
    expect(await exchangeAlipayCode("code")).toEqual({
      providerUserId: "123",
      nickname: "用户",
      avatar: "https://example.com/avatar.png",
    });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      "alipay.system.oauth.token",
      { grantType: "authorization_code", code: "code" },
      { validateSign: true },
    );
    expect(execute).toHaveBeenNthCalledWith(2, "POST", "/v3/alipay/user/info/share", {
      query: { auth_token: "secret" },
    });
  });
  it("不信任资料接口返回的另一用户身份", async () => {
    execute
      .mockResolvedValueOnce({ access_token: "secret", user_id: "123" })
      .mockResolvedValueOnce({ code: "10000", user_id: "456" });
    await expect(exchangeAlipayCode("code")).rejects.toMatchObject({ code: "OAUTH_CODE_INVALID" });
  });
  it("平台失败不返回令牌或错误正文", async () => {
    execute.mockRejectedValueOnce(new Error("token=secret"));
    await expect(exchangeAlipayCode("code")).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
      message: "登录平台暂时不可用，请稍后重试",
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

it("诊断保留换码失败位置和平台码，不泄露响应秘密", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  execute.mockRejectedValueOnce(
    Object.assign(new Error("验签失败 secret"), {
      responseDataRaw: JSON.stringify({
        error_response: { code: "40002", sub_code: "isv.code-invalid", access_token: "secret" },
        sign: "secret",
      }),
    }),
  );
  await expect(exchangeAlipayCode("secret")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(JSON.parse(log.mock.calls[0][0])).toEqual({
    event: "alipay_auth_failure",
    protocol: "v2",
    stage: "token",
    category: "signature",
    code: "40002",
    sub_code: "isv.code-invalid",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

it("资料失败能够区分阶段，并隐藏资料和令牌", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  execute.mockResolvedValueOnce({ access_token: "secret", user_id: "123" }).mockResolvedValueOnce({
    code: "40004",
    sub_code: "isv.insufficient-isv-permissions",
    nick_name: "secret",
  });
  await expect(exchangeAlipayCode("secret")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
    stage: "profile",
    category: "provider_business",
    code: "40004",
    sub_code: "isv.insufficient-isv-permissions",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

it("诊断错误说明移除凭据、编码凭据、邮箱和 URL", async () => {
  const { redactAlipayMessage } = await import("../../lib/auth/alipay-diagnostics");
  const result = redactAlipayMessage(
    "系统异常 secret+token secret%2Btoken auth_token=unknown somebody@example.com https://example.com/?code=secret 2088722037839494",
    ["secret+token"],
  );
  expect(result).toContain("系统异常");

  for (const secret of ["secret", "unknown", "somebody", "https://", "2088722037839494"]) {
    expect(result).not.toContain(secret);
  }
});

it.each([undefined, "", "   "])("换码缺少有效身份时拒绝登录：%s", async (userId) => {
  execute.mockResolvedValueOnce({ access_token: "secret", user_id: userId });
  await expect(exchangeAlipayCode("code", "sandbox")).rejects.toBeDefined();
  expect(execute).toHaveBeenCalledOnce();
});

it.each([
  { code: "40001", sub_code: "isv.invalid-auth-token" },
  { code: "40004", sub_code: "isv.insufficient-isv-permissions" },
  { code: "20000", sub_code: "other-error" },
  { code: "20000" },
])("沙箱不为其他资料错误降级：%j", async (failure) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  execute
    .mockResolvedValueOnce({ access_token: "secret", user_id: "123" })
    .mockResolvedValueOnce(failure);
  await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
});

it("换码业务失败即使带有身份也不能降级", async () => {
  execute.mockResolvedValueOnce({ code: "20000", access_token: "secret", user_id: "123" });
  await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
    code: "OAUTH_PROVIDER_ERROR",
  });
  expect(execute).toHaveBeenCalledOnce();
});

it("只有 open_id 时，资料恢复前后保持相同身份", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  execute
    .mockResolvedValueOnce({ access_token: "secret", open_id: "open123" })
    .mockResolvedValueOnce({ code: "20000", sub_code: "aop.unknow-error" });
  const fallback = await exchangeAlipayCode("code", "sandbox");
  execute
    .mockResolvedValueOnce({ access_token: "secret", open_id: "open123" })
    .mockResolvedValueOnce({ code: "10000", user_id: "123", open_id: "open123" });
  const recovered = await exchangeAlipayCode("new-code", "sandbox");
  expect(fallback.providerUserId).toBe("open123");
  expect(recovered.providerUserId).toBe(fallback.providerUserId);
});

it("任一同类身份不一致时拒绝登录", async () => {
  execute
    .mockResolvedValueOnce({ access_token: "secret", user_id: "123", open_id: "open123" })
    .mockResolvedValueOnce({ code: "10000", user_id: "123", open_id: "other" });
  await expect(exchangeAlipayCode("code", "sandbox")).rejects.toMatchObject({
    code: "OAUTH_CODE_INVALID",
  });
});

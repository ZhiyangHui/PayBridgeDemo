import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("alipay-sdk", () => ({
  AlipaySdk: class {
    exec = execute;
  },
}));
import { exchangeAlipayCode } from "../../src/server/auth/alipay";

beforeEach(() => execute.mockReset());

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
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "alipay.user.info.share",
      { authToken: "secret" },
      { validateSign: true },
    );
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
    stage: "token",
    category: "signature",
    code: "40002",
    sub_code: "isv.code-invalid",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

it("资料失败能够区分阶段，并隐藏资料和令牌", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  execute.mockResolvedValueOnce({ access_token: "secret" }).mockResolvedValueOnce({
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
  const { redactAlipayMessage } = await import("../../src/server/auth/alipay-diagnostics");
  const result = redactAlipayMessage(
    "系统异常 secret+token secret%2Btoken auth_token=unknown somebody@example.com https://example.com/?code=secret 2088722037839494",
    ["secret+token"],
  );
  expect(result).toContain("系统异常");

  for (const secret of ["secret", "unknown", "somebody", "https://", "2088722037839494"]) {
    expect(result).not.toContain(secret);
  }
});

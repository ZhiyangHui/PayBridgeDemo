import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { exchangeWechatCode, wechatAuthorizeUrl, wechatLoginConfig } from "../../lib/auth/wechat";

const config = { appId: "wx1234567890abcdef", appSecret: "a".repeat(32) };
const token = {
  access_token: "test-access-token",
  openid: "user-1",
  scope: "snsapi_login",
  unionid: "union-1",
};
const profile = {
  openid: "user-1",
  unionid: "union-1",
  nickname: "微信测试用户",
  headimgurl: "https://example.test/avatar.png",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** 提供两个可控响应，模拟微信换码和用户资料接口。 */
function replies(first: unknown = token, second: unknown = profile) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(second));
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

describe("微信网站应用 OAuth", () => {
  it("使用网站扫码登录 scope，并且回调地址只编码一次", () => {
    const callback = "https://shop.test/api/auth/wechat/callback";
    const url = new URL(wechatAuthorizeUrl("state-test", callback, config));
    expect(url.origin + url.pathname).toBe("https://open.weixin.qq.com/connect/qrconnect");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appid: config.appId,
      redirect_uri: callback,
      response_type: "code",
      scope: "snsapi_login",
      state: "state-test",
    });
  });

  it("服务端换码后核对 openid 和 unionid，不把令牌传给用户", async () => {
    const fetcher = replies();
    const result = await exchangeWechatCode("one-use-code", config);
    expect(result).toEqual({
      providerUserId: "user-1",
      unionId: "union-1",
      nickname: profile.nickname,
      avatar: profile.headimgurl,
    });
    const request = new URL(fetcher.mock.calls[0][0]);
    expect(request.pathname).toBe("/sns/oauth2/access_token");
    expect(request.searchParams.get("code")).toBe("one-use-code");
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("access_token")).toBe(
      token.access_token,
    );
    expect(JSON.stringify(result)).not.toContain(token.access_token);
  });

  it.each([
    { ...profile, openid: "other" },
    { ...profile, unionid: "other" },
  ])("拒绝身份不一致的资料", async (data) => {
    replies(token, data);
    await expect(exchangeWechatCode("code", config)).rejects.toMatchObject({
      code: "OAUTH_CODE_INVALID",
    });
  });

  it("HTTP 200 内的微信业务错误也会拒绝登录，日志不含令牌或密钥", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    replies({ errcode: 40029, errmsg: "invalid code" });
    await expect(exchangeWechatCode("secret-code", config)).rejects.toMatchObject({
      code: "OAUTH_PROVIDER_ERROR",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"code":40029'));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-code");
  });

  it("资料缺少昵称头像时保留真实身份并使用默认显示", async () => {
    replies(token, { openid: token.openid });
    expect(await exchangeWechatCode("code", config)).toMatchObject({
      nickname: "微信用户",
      avatar: null,
    });
  });

  it("缺少应用凭据时明确报错", () => {
    vi.stubEnv("WECHAT_APP_ID", "");
    vi.stubEnv("WECHAT_APP_SECRET", "");
    expect(wechatLoginConfig).toThrow("WECHAT_APP_ID");
  });

  it("网络失败不重复消费授权码", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetcher);
    await expect(exchangeWechatCode("code", config)).rejects.toMatchObject({
      code: "UPSTREAM_NETWORK",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

import "server-only";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { requestJson } from "../http/request";
import type { LoginProfile } from "./types";

/** 网站应用扫码登录所需的凭据；与微信支付商户配置分开使用。 */
export type WechatLoginConfig = { appId: string; appSecret: string };

/** 读取网站应用凭据，缺项或格式错误时报告配置名，不输出密钥。 */
export function wechatLoginConfig(): WechatLoginConfig {
  const appId = process.env.WECHAT_APP_ID ?? "";
  const appSecret = process.env.WECHAT_APP_SECRET ?? "";

  if (!/^wx[a-f0-9]{16}$/i.test(appId) || !/^[a-f0-9]{32}$/i.test(appSecret)) {
    throw new AppError("CONFIG_ERROR", "请检查 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
  }

  return { appId, appSecret };
}

/** 生成开放平台网站应用的扫码授权地址，二维码由微信官方页面显示。 */
export function wechatAuthorizeUrl(
  state: string,
  callback: string,
  config: WechatLoginConfig,
): string {
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.search = new URLSearchParams({
    appid: config.appId,
    redirect_uri: callback,
    response_type: "code",
    scope: "snsapi_login",
    state,
  }).toString();
  url.hash = "wechat_redirect";

  return url.toString();
}

/** 换码成功必须返回访问令牌和当前应用下的用户标识。 */
const tokenSchema = z.object({
  access_token: z.string().min(1),
  openid: z.string().min(1).max(128),
  scope: z.string(),
  unionid: z.string().min(1).max(128).optional(),
});

/** 用户资料必须带 openid；昵称或头像缺失时允许使用默认显示。 */
const profileSchema = z.object({
  openid: z.string().min(1).max(128),
  unionid: z.string().min(1).max(128).optional(),
  nickname: z.string().max(256).optional(),
  headimgurl: z.string().optional(),
});

/**
 * 请求微信授权接口并检查业务错误码。
 * 微信可能在 HTTP 200 中返回 errcode；日志只记录阶段和数字错误码。
 */
async function wechatRequest(url: URL, stage: "token" | "profile") {
  const data = await requestJson(url.toString(), z.record(z.string(), z.unknown()));

  if (data.errcode !== undefined && data.errcode !== 0) {
    console.error(
      JSON.stringify({
        event: "wechat_auth_failure",
        stage,
        code: typeof data.errcode === "number" ? data.errcode : "invalid_response",
      }),
    );
    throw new AppError("OAUTH_PROVIDER_ERROR");
  }

  return data;
}

/**
 * 用一次性授权码换取微信用户资料，供共用登录流程建立会话。
 * @returns openid、可选 unionid、昵称和 HTTPS 头像，不返回或保存访问令牌。
 * @throws AppError 换码失败、资料异常或身份不一致时拒绝登录。
 */
export async function exchangeWechatCode(
  code: string,
  config = wechatLoginConfig(),
): Promise<LoginProfile> {
  try {
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.search = new URLSearchParams({
      appid: config.appId,
      secret: config.appSecret,
      code,
      grant_type: "authorization_code",
    }).toString();
    // 授权码只能消费一次，换码请求不自动重试。
    const token = tokenSchema.parse(await wechatRequest(tokenUrl, "token"));

    if (!token.scope.split(",").includes("snsapi_login")) {
      throw new AppError("OAUTH_PROVIDER_ERROR");
    }

    const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    profileUrl.search = new URLSearchParams({
      access_token: token.access_token,
      openid: token.openid,
      lang: "zh_CN",
    }).toString();
    const profile = profileSchema.parse(await wechatRequest(profileUrl, "profile"));

    // 资料必须属于刚才授权的用户，不能用另一用户的资料建立会话。
    if (
      profile.openid !== token.openid ||
      (token.unionid && profile.unionid && token.unionid !== profile.unionid)
    ) {
      throw new AppError("OAUTH_CODE_INVALID");
    }

    return {
      providerUserId: token.openid,
      unionId: profile.unionid ?? token.unionid,
      nickname: profile.nickname?.trim() || "微信用户",
      avatar: profile.headimgurl?.startsWith("https://") ? profile.headimgurl : null,
    };
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }

    throw new AppError("OAUTH_PROVIDER_ERROR", undefined, { cause });
  }
}

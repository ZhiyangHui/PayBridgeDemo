/** 支持的登录渠道，保持与数据库枚举一致。 */
export type LoginProvider = "wechat" | "alipay";

/** 平台验证后返回的用户资料，不含访问令牌。 */
export type LoginProfile = {
  /** 平台用户标识；模拟登录时为 mock_ 开头的本站测试账号 ID。 */
  providerUserId: string;
  /** 用于页面显示的昵称。 */
  nickname: string;
  /** 头像地址；没有可用头像时为 null。 */
  avatar: string | null;
  /** 可选的微信跨应用用户标识，未提供时不参与身份匹配。 */
  unionId?: string;
};

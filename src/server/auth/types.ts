/** 支持的登录渠道，保持与数据库枚举一致。 */
export type LoginProvider = "wechat" | "alipay";

/** 平台验证后返回的用户资料，不含访问令牌。 */
export type LoginProfile = {
  providerUserId: string;
  nickname: string;
  avatar: string | null;
  unionId?: string;
};

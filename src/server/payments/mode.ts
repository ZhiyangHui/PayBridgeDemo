import { getEnv } from "../config/env";
import type { LoginProvider } from "../auth/types";

/**
 * 读取指定支付渠道当前使用的运行模式。
 * 微信返回 WECHAT_MODE，支付宝返回 PAYMENT_MODE；本函数不根据用户输入切换配置。
 */
export function paymentMode(provider: LoginProvider): "mock" | "sandbox" | "live" {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE : env.PAYMENT_MODE;
}

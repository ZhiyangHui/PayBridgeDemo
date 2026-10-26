import { getEnv } from "../config/env";
import type { LoginProvider } from "../auth/types";

/** 微信与支付宝支付分别取服务端模式，不跟随登录方式切换。 */
export function paymentMode(provider: LoginProvider): "mock" | "sandbox" | "live" {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE : env.PAYMENT_MODE;
}

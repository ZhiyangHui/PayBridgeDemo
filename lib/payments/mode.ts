import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import type { LoginProvider, PaymentMode } from "../auth/types";

/**
 * 读取服务端允许使用的真实支付环境，供平台接口及通知校验使用。
 * 用户下单必须使用 sessionPaymentMode，不能直接用全局配置代替会话选择。
 */
export function paymentMode(provider: LoginProvider): "mock" | "sandbox" | "live" {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE : env.PAYMENT_MODE;
}

/**
 * 读取会话中已保存的支付模式，并检查对应平台环境仍已启用。
 * 模拟会话始终返回 mock；表单和网址中的 mode 不参与此判断。
 */
export function sessionPaymentMode(session: {
  provider: LoginProvider;
  paymentMode: string;
}): PaymentMode {
  if (session.paymentMode === "mock") {
    return "mock";
  }

  if (
    (session.paymentMode === "sandbox" || session.paymentMode === "live") &&
    session.paymentMode === paymentMode(session.provider)
  ) {
    return session.paymentMode;
  }

  throw new AppError("PAYMENT_UNAVAILABLE", "当前入口对应的支付环境未启用，请重新选择入口");
}

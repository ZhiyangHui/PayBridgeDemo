import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import type { LoginProvider, PaymentMode } from "../auth/types";

/** 读取指定支付渠道的服务端配置，用于平台请求和通知校验。 */
export function paymentMode(provider: LoginProvider): PaymentMode {
  const env = getEnv();

  return provider === "wechat" ? env.WECHAT_MODE : env.PAYMENT_MODE;
}

/**
 * 读取本次会话的支付环境；传入付款渠道时，返回该渠道的实际模式。
 * 登录渠道不参与判断。旧模拟会话始终保持模拟，不能因配置变化升级到真实付款。
 * @throws AppError 沙箱或正式环境已变更时要求重新登录。
 */
export function sessionPaymentMode(
  session: { paymentMode: string },
  provider?: LoginProvider,
): PaymentMode {
  if (session.paymentMode === "mock") {
    return "mock";
  }

  const env = getEnv();

  if (
    (session.paymentMode !== "sandbox" && session.paymentMode !== "live") ||
    session.paymentMode !== env.PAYMENT_MODE
  ) {
    throw new AppError("PAYMENT_UNAVAILABLE", "支付环境已变更，请重新登录");
  }

  return provider ? paymentMode(provider) : session.paymentMode;
}

/** 判断当前会话是否有模拟付款方式，供余额展示和调整使用。 */
export function hasMockPayment(session: { paymentMode: string }): boolean {
  return (
    sessionPaymentMode(session, "wechat") === "mock" ||
    sessionPaymentMode(session, "alipay") === "mock"
  );
}

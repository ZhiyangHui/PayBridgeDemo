import type { PrismaClient } from "../../generated/prisma/client";
import type { LoginProvider } from "../auth/types";
import { settleMockPayment } from "../orders/service";
import { verifyNotification, type NotificationConfig } from "./notification";

/**
 * 验证模拟支付通知，并调用订单模块更新状态和扣除模拟余额。
 * @param config 模拟平台的验签公钥、解密密钥及应用和商户标识。
 * @returns 支付宝返回纯文本 success，微信返回包含 SUCCESS 的 JSON。
 * @throws 验签、解密或记账失败时向上抛出，不返回成功确认。
 */
export async function handleMockNotification(
  db: PrismaClient,
  request: Request,
  provider: LoginProvider,
  config: NotificationConfig,
) {
  const notice = verifyNotification(provider, await request.text(), request.headers, config);
  await settleMockPayment(db, notice);

  if (provider === "alipay") {
    return new Response("success");
  }

  return Response.json({ code: "SUCCESS", message: "成功" });
}

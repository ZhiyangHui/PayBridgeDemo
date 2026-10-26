import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import { TEST_ITEM } from "./service";
import type { PaymentNotice } from "../payments/notification";

/** 下单时固定收款身份，后续通知和查单必须与之一致。 */
export type PaymentMerchant = { appId: string; merchantId: string };

/** 本站会话拥有订单；支付宝付款账号由官方收银台验证，不依赖会员资料接口。 */
export async function createSandboxOrder(
  db: PrismaClient,
  userId: string,
  checkoutKey: string,
  merchant: PaymentMerchant,
) {
  if (!/^[a-f0-9-]{36}$/.test(checkoutKey)) {
    throw new AppError("INVALID_INPUT");
  }

  const order = await db.order.upsert({
    where: { checkoutKey },
    update: {},
    create: {
      userId,
      checkoutKey,
      provider: "alipay",
      mode: "sandbox",
      outTradeNo: `PB${randomUUID().replaceAll("-", "")}`,
      amountFen: TEST_ITEM.amountFen,
      currency: "CNY",
      paymentAppId: merchant.appId,
      paymentSellerId: merchant.merchantId,
    },
  });

  if (
    order.userId !== userId ||
    order.mode !== "sandbox" ||
    order.provider !== "alipay" ||
    order.paymentAppId !== merchant.appId ||
    order.paymentSellerId !== merchant.merchantId
  ) {
    throw new AppError("CONFLICT");
  }

  return order;
}

/** 只接受已验签的支付事实；不改模拟钱包，重复通知和查单共用同一事务。 */
export async function settleSandboxPayment(
  db: PrismaClient,
  notice: PaymentNotice,
  merchant: PaymentMerchant,
) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { outTradeNo: notice.outTradeNo } });

    if (
      !order ||
      order.mode !== "sandbox" ||
      order.provider !== "alipay" ||
      notice.provider !== "alipay" ||
      order.paymentAppId !== merchant.appId ||
      order.paymentSellerId !== merchant.merchantId ||
      order.amountFen !== notice.amountFen ||
      order.currency !== notice.currency
    ) {
      throw new AppError("PAYMENT_INVALID");
    }

    const status = notice.status ?? "paid";

    // 已支付订单不因关闭通知回退；退款不在本项目范围内。
    if (
      order.providerTradeNo === notice.tradeNo &&
      (order.status === "paid" || order.status === status)
    ) {
      return;
    }

    const changed = await tx.order.updateMany({
      where: { id: order.id, status: "pending" },
      data: {
        status,
        providerTradeNo: notice.tradeNo,
        paidAt: status === "paid" ? new Date() : null,
      },
    });

    if (changed.count !== 1) {
      throw new AppError("CONFLICT");
    }

    await tx.paymentNotification.create({
      data: {
        provider: "alipay",
        dedupeKey: notice.dedupeKey,
        orderId: order.id,
        result: status,
      },
    });
  });
}

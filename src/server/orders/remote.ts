import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import { TEST_ITEM } from "./service";
import type { PaymentNotice } from "../payments/notification";

/** 支付平台收款身份，包含应用 ID 和商户 ID。 */
export type PaymentMerchant = { appId: string; merchantId: string };

/** 真实订单所属渠道、运行环境和收款身份。 */
export type RemoteMerchant = PaymentMerchant & {
  provider: "alipay" | "wechat";
  mode: "sandbox" | "live";
};

/**
 * 创建金额为 0.01 元的真实平台待付款订单。
 * 同一 checkoutKey 重复提交时返回原订单，并核对用户、渠道、环境和商户是否一致。
 * @param merchant 下单时使用的应用 ID 和商户 ID，会一同保存到订单。
 * @throws AppError 提交键格式错误时抛出 INVALID_INPUT，复用的订单不匹配时抛出 CONFLICT。
 */
export async function createRemoteOrder(
  db: PrismaClient,
  userId: string,
  checkoutKey: string,
  merchant: RemoteMerchant,
) {
  if (!/^[a-f0-9-]{36}$/.test(checkoutKey)) {
    throw new AppError("INVALID_INPUT");
  }

  // 按提交键创建或复用订单，金额固定取服务端测试商品价格。
  const order = await db.order.upsert({
    where: { checkoutKey },
    update: {},
    create: {
      userId,
      checkoutKey,
      provider: merchant.provider,
      mode: merchant.mode,
      outTradeNo: randomUUID().replaceAll("-", ""),
      amountFen: TEST_ITEM.amountFen,
      currency: "CNY",
      paymentAppId: merchant.appId,
      paymentSellerId: merchant.merchantId,
    },
  });

  // 复用订单时重新核对归属和收款配置，不允许拿别人的提交键下单。
  if (
    order.userId !== userId ||
    order.mode !== merchant.mode ||
    order.provider !== merchant.provider ||
    order.paymentAppId !== merchant.appId ||
    order.paymentSellerId !== merchant.merchantId
  ) {
    throw new AppError("CONFLICT");
  }

  return order;
}

/**
 * 根据已验证的支付结果，将真实订单更新为已支付、失败或已关闭。
 * 核对订单身份、金额和币种，在同一事务中更新订单并记录通知，不修改模拟余额。
 * 重复的相同交易结果直接返回，已支付订单收到同一交易的关闭通知也不回退。
 * @param notice 已由通知验签或平台查单验证的支付结果。
 * @throws AppError 数据不匹配时抛出 PAYMENT_INVALID，订单状态不允许更新时抛出 CONFLICT。
 */
export async function settleRemotePayment(
  db: PrismaClient,
  notice: PaymentNotice,
  merchant: RemoteMerchant,
) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { outTradeNo: notice.outTradeNo } });

    // 核对通知对应的订单、支付环境、收款身份和金额。
    if (
      !order ||
      order.mode !== merchant.mode ||
      order.provider !== merchant.provider ||
      notice.provider !== merchant.provider ||
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

    // 仅更新仍待付款的订单；并发通知已处理时，当前更新不会覆盖它。
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

    // 保存本次支付结果；保存失败会连同上面的订单更新一起回滚。
    await tx.paymentNotification.create({
      data: {
        provider: merchant.provider,
        dedupeKey: notice.dedupeKey,
        orderId: order.id,
        result: status,
      },
    });
  });
}

import "server-only";
import { z } from "zod";
import type { Order, PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import { settleRemotePayment } from "../orders/remote";
import { verifyNotification, type PaymentNotice } from "./notification";
import { wechatPayRequest, WechatApiError, type WechatPaymentConfig } from "./wechat-client";

/** 检查订单是否属于当前微信商户、应用和正式环境。 */
function checkWechatOrder(order: Order, config: WechatPaymentConfig): void {
  if (
    order.provider !== "wechat" ||
    order.mode !== "live" ||
    order.currency !== "CNY" ||
    order.paymentAppId !== config.appId ||
    order.paymentSellerId !== config.merchantId
  ) {
    throw new AppError("PAYMENT_INVALID");
  }
}

/**
 * 验证查单结果的商户、订单和金额，并转换为本站支付状态。
 * @returns 待付款返回 null；已付款、已关闭或支付失败返回可落库的结果。
 */
function queryNotice(
  data: unknown,
  order: Order,
  config: WechatPaymentConfig,
): PaymentNotice | null {
  const trade = z
    .object({
      appid: z.literal(config.appId),
      mchid: z.literal(config.merchantId),
      out_trade_no: z.literal(order.outTradeNo),
      trade_type: z.literal("NATIVE").optional(),
      trade_state: z.enum(["SUCCESS", "NOTPAY", "USERPAYING", "CLOSED", "REVOKED", "PAYERROR"]),
      transaction_id: z.string().min(1).max(64).optional(),
      amount: z.object({ total: z.literal(order.amountFen), currency: z.literal("CNY") }),
    })
    .safeParse(data);

  if (!trade.success) {
    throw new AppError("PAYMENT_INVALID");
  }

  const result = trade.data;

  if (result.trade_state === "NOTPAY" || result.trade_state === "USERPAYING") {
    return null;
  }

  // 成功必须有微信交易号；未付款即关闭的订单可能没有交易号。
  if (result.trade_state === "SUCCESS" && !result.transaction_id) {
    throw new AppError("PAYMENT_INVALID");
  }

  let status: "paid" | "closed" | "failed" = "closed";

  if (result.trade_state === "SUCCESS") {
    status = "paid";
  } else if (result.trade_state === "PAYERROR") {
    status = "failed";
  }

  return {
    provider: "wechat",
    outTradeNo: order.outTradeNo,
    tradeNo: result.transaction_id ?? `closed:${order.outTradeNo}`,
    amountFen: order.amountFen,
    currency: "CNY",
    status,
    dedupeKey: `query:${order.outTradeNo}:${result.trade_state}`,
  };
}

/** 查询微信订单；只有已验签的 ORDER_NOT_EXIST 才视为平台尚未建单。 */
export async function queryWechatOrder(
  order: Order,
  config: WechatPaymentConfig,
): Promise<PaymentNotice | null> {
  checkWechatOrder(order, config);
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.outTradeNo)}?mchid=${encodeURIComponent(config.merchantId)}`;

  try {
    const data = await wechatPayRequest("GET", path, undefined, z.unknown(), config);

    return queryNotice(data, order, config);
  } catch (cause) {
    if (
      cause instanceof WechatApiError &&
      cause.status === 404 &&
      cause.providerCode === "ORDER_NOT_EXIST"
    ) {
      return null;
    }

    throw cause;
  }
}

/**
 * 为已保存的待付款订单创建 Native 付款码，并保存微信返回的 code_url。
 * 已有二维码时直接复用；请求失败仍保留订单，用户可在订单页重试。
 */
export async function createWechatPayment(
  db: PrismaClient,
  order: Order,
  config: WechatPaymentConfig,
) {
  checkWechatOrder(order, config);

  if (order.status !== "pending" || order.paymentUrl) {
    return order;
  }

  // 上次下单可能已到达平台但响应丢失，先查单，不能另建订单或猜测失败。
  const notice = await queryWechatOrder(order, config);

  if (notice) {
    await settleRemotePayment(db, notice, { ...config, provider: "wechat", mode: "live" });

    return db.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  const data = await wechatPayRequest(
    "POST",
    "/v3/pay/transactions/native",
    {
      appid: config.appId,
      mchid: config.merchantId,
      description: order.productName,
      out_trade_no: order.outTradeNo,
      notify_url: config.notifyUrl,
      amount: { total: order.amountFen, currency: order.currency },
    },
    z.object({ code_url: z.string().max(2048).startsWith("weixin://wxpay/bizpayurl?") }),
    config,
  );

  // 不覆盖并发通知已经写入的已支付状态，只补充待付款订单的二维码。
  await db.order.updateMany({
    where: { id: order.id, status: "pending" },
    data: { paymentUrl: data.code_url },
  });

  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}

/** 验证并解密微信通知，核对订单后记账；成功返回微信要求的空 HTTP 204。 */
export async function handleWechatNotification(
  db: PrismaClient,
  request: Request,
  config: WechatPaymentConfig,
) {
  const notice = verifyNotification("wechat", await request.text(), request.headers, config);
  await settleRemotePayment(db, notice, { ...config, provider: "wechat", mode: "live" });

  return new Response(null, { status: 204 });
}

/**
 * 更新待付款订单的状态，补回漏掉的微信通知。
 * 每个订单最多十秒查询一次；网络失败、无效签名或未知状态都不修改付款状态。
 */
export async function refreshWechatOrder(
  db: PrismaClient,
  order: Order,
  config: WechatPaymentConfig,
) {
  checkWechatOrder(order, config);

  if (order.status !== "pending") {
    return order;
  }

  const claimed = await db.order.updateMany({
    where: {
      id: order.id,
      status: "pending",
      OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lt: new Date(Date.now() - 10_000) } }],
    },
    data: { lastQueriedAt: new Date() },
  });

  if (claimed.count) {
    const notice = await queryWechatOrder(order, config);

    if (notice) {
      await settleRemotePayment(db, notice, { ...config, provider: "wechat", mode: "live" });
    }
  }

  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}

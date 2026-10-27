import "server-only";
import { AlipaySdk } from "alipay-sdk";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import type { Order, PrismaClient } from "../../generated/prisma/client";
import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import { formatMoney, parseMoney } from "../orders/money";
import { TEST_ITEM } from "../orders/service";
import { settleSandboxPayment, type PaymentMerchant } from "../orders/sandbox";
import { verifyAlipayNotification } from "./notification";

/** 支付宝下单、查单和通知验签所需的服务端配置。 */
export type AlipayPaymentConfig = PaymentMerchant & {
  /** 当前应用的 PKCS8 私钥，用于请求签名。 */
  privateKey: string;
  /** 支付宝公钥，用于验证平台返回的数据。 */
  publicKey: string;
  /** 当前支付环境的 API 网关完整地址。 */
  gateway: string;
  /** 接收服务器异步支付通知的公网地址。 */
  notifyUrl: string;
  /** 付款后浏览器跳回的站内页面地址。 */
  returnUrl: string;
};

/**
 * 读取支付宝沙箱付款所需的应用、商户、密钥和回调配置。
 * 将支付宝公钥转换为 PEM 格式，返回供下单、验签和查单使用的配置。
 * @throws AppError 当前支付环境不是 sandbox 时抛出 PAYMENT_UNAVAILABLE；环境配置错误由 getEnv 抛出。
 */
export function alipayPaymentConfig(): AlipayPaymentConfig {
  if (getEnv().PAYMENT_MODE !== "sandbox") {
    throw new AppError("PAYMENT_UNAVAILABLE");
  }

  // 读取支付宝验签公钥；控制台复制的裸公钥需要补齐 PEM 头尾。
  const raw = process.env.ALIPAY_PUBLIC_KEY!;
  const publicKey = createPublicKey(
    raw.includes("-----BEGIN")
      ? raw
      : `-----BEGIN PUBLIC KEY-----\n${raw}\n-----END PUBLIC KEY-----`,
  )
    .export({ type: "spki", format: "pem" })
    .toString();

  return {
    appId: process.env.ALIPAY_APP_ID!,
    merchantId: process.env.ALIPAY_SELLER_ID!,
    privateKey: process.env.ALIPAY_PRIVATE_KEY!,
    publicKey,
    gateway: process.env.ALIPAY_GATEWAY!,
    notifyUrl: process.env.ALIPAY_NOTIFY_URL!,
    returnUrl: process.env.ALIPAY_RETURN_URL!,
  };
}

/**
 * 创建用于支付宝付款和查单的 SDK 客户端。
 * @param config 服务端读取的应用身份、密钥和网关配置。
 * @returns 使用 PKCS8 私钥、保留原字段名、请求超时为 8 秒的客户端。
 */
function client(config: AlipayPaymentConfig) {
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    keyType: "PKCS8",
    alipayPublicKey: config.publicKey,
    gateway: config.gateway,
    camelcase: false,
    timeout: 8000,
  });
}

/**
 * 检查订单是否为当前支付宝应用和商户的沙箱订单。
 * 校验支付环境、支付渠道、币种、应用 ID 和商户 ID。
 * @throws AppError 任意字段不符合要求时抛出 PAYMENT_INVALID。
 */
function checkOrder(order: Order, config: PaymentMerchant): void {
  if (
    order.mode !== "sandbox" ||
    order.provider !== "alipay" ||
    order.currency !== "CNY" ||
    order.paymentAppId !== config.appId ||
    order.paymentSellerId !== config.merchantId
  ) {
    throw new AppError("PAYMENT_INVALID");
  }
}

/**
 * 为待付款订单生成支付宝官方收银台地址。
 * 金额和商品信息取自服务端，返回地址附带本站订单 ID。
 * @param order 已保存到数据库的订单。
 * @returns 带 SDK 签名的收银台 URL，不会在此处将订单标记为已支付。
 * @throws AppError 订单身份不匹配时抛出 PAYMENT_INVALID，非待付款状态时抛出 CONFLICT。
 */
export function alipayCheckoutUrl(order: Order, config: AlipayPaymentConfig): string {
  checkOrder(order, config);

  if (order.status !== "pending") {
    throw new AppError("CONFLICT");
  }

  // 返回页面只接收本站订单 ID，支付结果仍由通知或查单确认。
  const returnUrl = new URL(config.returnUrl);
  returnUrl.searchParams.set("order", order.id);

  return client(config).pageExecute("alipay.trade.page.pay", "GET", {
    notifyUrl: config.notifyUrl,
    returnUrl: returnUrl.toString(),
    // 提交订单号、固定金额和商品名，并设置收银台付款有效期为 15 分钟。
    bizContent: {
      outTradeNo: order.outTradeNo,
      totalAmount: formatMoney(order.amountFen),
      subject: TEST_ITEM.name,
      productCode: "FAST_INSTANT_TRADE_PAY",
      timeoutExpress: "15m",
    },
  });
}

/**
 * 读取支付宝通知，验证签名和业务字段，再更新沙箱订单。
 * @param request 支付宝发送的原始表单请求。
 * @returns 处理成功后返回纯文本 success；重复的有效通知同样返回 success。
 * @throws 通知校验或订单更新失败时向上抛出，由接口返回失败响应。
 */
export async function handleAlipayNotification(
  db: PrismaClient,
  request: Request,
  config: AlipayPaymentConfig,
) {
  const notice = verifyAlipayNotification(await request.text(), config);
  await settleSandboxPayment(db, notice, config);

  return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * 向支付宝查询订单状态，并将有效结果转换为本站的支付通知数据。
 * 校验响应签名、商户订单号、金额和状态；待支付或交易不存在时返回 null。
 * @returns 已支付或已关闭的支付结果，本函数不写数据库。
 * @throws AppError 请求失败、验签失败或结果不符合要求时抛出 PAYMENT_PROVIDER_ERROR。
 */
export async function queryAlipayOrder(order: Order, config: AlipayPaymentConfig) {
  checkOrder(order, config);
  let result: unknown;

  try {
    result = await client(config).exec(
      "alipay.trade.query",
      { bizContent: { outTradeNo: order.outTradeNo } },
      { validateSign: true },
    );
    // 先读取业务码，交易尚未建立时保留本站订单的待付款状态。
    const reply = z.object({ code: z.string(), sub_code: z.string().optional() }).parse(result);

    if (reply.code === "40004" && reply.sub_code === "ACQ.TRADE_NOT_EXIST") {
      return null;
    }

    // 校验成功响应的订单号、交易号、收款商户和已知交易状态。
    const trade = z
      .object({
        code: z.literal("10000"),
        out_trade_no: z.literal(order.outTradeNo),
        trade_no: z.string().min(1).max(64),
        total_amount: z.string(),
        trade_status: z.enum(["WAIT_BUYER_PAY", "TRADE_SUCCESS", "TRADE_FINISHED", "TRADE_CLOSED"]),
        seller_id: z.literal(config.merchantId).optional(),
      })
      .parse(result);

    // 将平台返回的元金额转成分，与订单金额逐分比较。
    if (parseMoney(trade.total_amount) !== order.amountFen) {
      throw new AppError("PAYMENT_INVALID");
    }

    if (trade.trade_status === "WAIT_BUYER_PAY") {
      return null;
    }

    // 将支付宝交易状态转换成本站订单状态，交给订单模块保存。
    return {
      provider: "alipay" as const,
      outTradeNo: order.outTradeNo,
      tradeNo: trade.trade_no,
      amountFen: order.amountFen,
      currency: "CNY" as const,
      status: trade.trade_status === "TRADE_CLOSED" ? ("closed" as const) : ("paid" as const),
      dedupeKey: `query:${trade.trade_no}:${trade.trade_status}`,
    };
  } catch (cause) {
    // 提取允许记录的错误码和追踪号，不记录完整请求或响应。
    const error = cause as { traceId?: unknown };
    const reply = z
      .object({
        code: z
          .string()
          .regex(/^[A-Za-z0-9_.-]{1,100}$/)
          .optional(),
        sub_code: z
          .string()
          .regex(/^[A-Za-z0-9_.-]{1,100}$/)
          .optional(),
      })
      .safeParse(result);
    console.error(
      JSON.stringify({
        event: "alipay_payment_failure",
        stage: "query",
        traceId:
          typeof error?.traceId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(error.traceId)
            ? error.traceId
            : undefined,
        ...(reply.success ? reply.data : {}),
      }),
    );

    throw new AppError("PAYMENT_PROVIDER_ERROR", undefined, { cause });
  }
}

/**
 * 查询待付款订单的支付宝状态，必要时更新数据库并返回最新订单。
 * 同一订单十秒内最多发起一次平台查询；非待付款订单直接返回。
 * @throws 查单或入库失败时向上抛出，不把未知结果当作付款成功。
 */
export async function refreshAlipayOrder(
  db: PrismaClient,
  order: Order,
  config: AlipayPaymentConfig,
) {
  checkOrder(order, config);

  if (order.status !== "pending") {
    return order;
  }

  // 用条件更新领取本轮查单机会，其他并发请求读取现有订单。
  const claimed = await db.order.updateMany({
    where: {
      id: order.id,
      status: "pending",
      OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lt: new Date(Date.now() - 10_000) } }],
    },
    data: { lastQueriedAt: new Date() },
  });

  if (claimed.count) {
    const notice = await queryAlipayOrder(order, config);

    // 只有查到明确的已支付或已关闭结果时才写入数据库。
    if (notice) {
      await settleSandboxPayment(db, notice, config);
    }
  }

  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}

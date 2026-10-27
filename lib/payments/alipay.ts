import "server-only";
import { AlipaySdk } from "alipay-sdk";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import type { Order, PrismaClient } from "../../generated/prisma/client";
import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import { formatMoney, parseMoney } from "../orders/money";
import { settleSandboxPayment, type PaymentMerchant } from "../orders/sandbox";
import { verifyAlipayNotification } from "./notification";

/** 支付配置只来自服务端，不允许浏览器指定网关、收款人或金额。 */
export type AlipayPaymentConfig = PaymentMerchant & {
  privateKey: string;
  publicKey: string;
  gateway: string;
  notifyUrl: string;
  returnUrl: string;
};

/** 当前阶段只开放支付宝沙箱付款，避免误触发正式资金交易。 */
export function alipayPaymentConfig(): AlipayPaymentConfig {
  if (getEnv().PAYMENT_MODE !== "sandbox") {
    throw new AppError("PAYMENT_UNAVAILABLE");
  }

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

/** PC 网站支付按官方页面接口签名；查单响应必须经过支付宝公钥验签。 */
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

/** 同一订单只允许在创建时的沙箱应用下继续付款或查单。 */
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

/** 生成支付宝官方收银台地址；浏览器返回地址只用于展示，不用于确认已付款。 */
export function alipayCheckoutUrl(order: Order, config: AlipayPaymentConfig): string {
  checkOrder(order, config);

  if (order.status !== "pending") {
    throw new AppError("CONFLICT");
  }

  const returnUrl = new URL(config.returnUrl);
  returnUrl.searchParams.set("order", order.id);

  return client(config).pageExecute("alipay.trade.page.pay", "GET", {
    notifyUrl: config.notifyUrl,
    returnUrl: returnUrl.toString(),
    bizContent: {
      outTradeNo: order.outTradeNo,
      totalAmount: formatMoney(order.amountFen),
      subject: order.productName,
      productCode: "FAST_INSTANT_TRADE_PAY",
      timeoutExpress: "15m",
    },
  });
}

/** 接收异步通知，验签及商户校验后才进入订单事务。 */
export async function handleAlipayNotification(
  db: PrismaClient,
  request: Request,
  config: AlipayPaymentConfig,
) {
  const notice = verifyAlipayNotification(await request.text(), config);
  await settleSandboxPayment(db, notice, config);

  return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** 查单只接受已验签的已知状态；不存在的交易仍保留待支付。 */
export async function queryAlipayOrder(order: Order, config: AlipayPaymentConfig) {
  checkOrder(order, config);
  let result: unknown;

  try {
    result = await client(config).exec(
      "alipay.trade.query",
      { bizContent: { outTradeNo: order.outTradeNo } },
      { validateSign: true },
    );
    const reply = z.object({ code: z.string(), sub_code: z.string().optional() }).parse(result);

    if (reply.code === "40004" && reply.sub_code === "ACQ.TRADE_NOT_EXIST") {
      return null;
    }

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

    if (parseMoney(trade.total_amount) !== order.amountFen) {
      throw new AppError("PAYMENT_INVALID");
    }

    if (trade.trade_status === "WAIT_BUYER_PAY") {
      return null;
    }

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

/** 每个待付款订单最多十秒查一次平台；超时和未知结果不改订单状态。 */
export async function refreshAlipayOrder(
  db: PrismaClient,
  order: Order,
  config: AlipayPaymentConfig,
) {
  checkOrder(order, config);

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
    const notice = await queryAlipayOrder(order, config);

    if (notice) {
      await settleSandboxPayment(db, notice, config);
    }
  }

  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}

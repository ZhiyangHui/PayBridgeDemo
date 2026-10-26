import { createDecipheriv, verify } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { parseMoney } from "../orders/money";
import type { LoginProvider } from "../auth/types";

/** 由服务端配置的验签公钥及平台身份，不接受通知自带的信任配置。 */
export type NotificationConfig = {
  publicKey: string;
  apiV3Key: Buffer;
  appId: string;
  merchantId: string;
  serial: string;
};

/** 验签后供订单模块处理的支付事实。 */
export type PaymentNotice = {
  provider: LoginProvider;
  outTradeNo: string;
  tradeNo: string;
  amountFen: number;
  currency: "CNY";
  dedupeKey: string;
  status?: "paid" | "closed";
};

/** 支付宝支付通知按非空参数排序，排除签名及签名类型。 */
export function alipaySigningText(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== "sign" && key !== "sign_type" && fields[key] !== "")
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
}

/** 严格解析 Base64，拒绝被解码器忽略的尾随内容。 */
function validSignature(text: string, signature: string, publicKey: string): boolean {
  const bytes = Buffer.from(signature, "base64");

  return (
    bytes.toString("base64") === signature &&
    verify("RSA-SHA256", Buffer.from(text), publicKey, bytes)
  );
}

/** 校验支付宝 RSA2 通知后提取订单信息。 */
function alipayNotice(
  raw: string,
  config: Pick<NotificationConfig, "publicKey" | "appId" | "merchantId">,
): PaymentNotice {
  const params = new URLSearchParams(raw);
  const fields = Object.fromEntries(params);

  if (
    params.size !== Object.keys(fields).length ||
    fields.sign_type !== "RSA2" ||
    !validSignature(alipaySigningText(fields), fields.sign ?? "", config.publicKey)
  ) {
    throw new AppError("PAYMENT_INVALID");
  }

  const data = z
    .object({
      app_id: z.literal(config.appId),
      seller_id: z.literal(config.merchantId),
      out_trade_no: z.string().min(1).max(64),
      trade_no: z.string().min(1).max(64),
      notify_id: z.string().min(1).max(128),
      total_amount: z.string(),
      trade_status: z.enum(["TRADE_SUCCESS", "TRADE_FINISHED", "TRADE_CLOSED"]),
    })
    .parse(fields);

  return {
    provider: "alipay",
    outTradeNo: data.out_trade_no,
    tradeNo: data.trade_no,
    amountFen: parseMoney(data.total_amount),
    currency: "CNY",
    dedupeKey: data.notify_id,
    status: data.trade_status === "TRADE_CLOSED" ? "closed" : "paid",
  };
}

/** 先验微信原始通知签名，再用 API v3 密钥解密，最后校验商户与应用。 */
function wechatNotice(raw: string, headers: Headers, config: NotificationConfig): PaymentNotice {
  const timestamp = headers.get("Wechatpay-Timestamp") ?? "";
  const nonce = headers.get("Wechatpay-Nonce") ?? "";
  const signature = headers.get("Wechatpay-Signature") ?? "";

  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !nonce ||
    headers.get("Wechatpay-Serial") !== config.serial ||
    !validSignature(`${timestamp}\n${nonce}\n${raw}\n`, signature, config.publicKey)
  ) {
    throw new AppError("PAYMENT_INVALID");
  }

  const envelope = z
    .object({
      id: z.string().min(1).max(128),
      event_type: z.literal("TRANSACTION.SUCCESS"),
      resource: z.object({
        algorithm: z.literal("AEAD_AES_256_GCM"),
        ciphertext: z.string(),
        nonce: z.string().length(12),
        associated_data: z.string(),
      }),
    })
    .parse(JSON.parse(raw));
  const resource = envelope.resource;
  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", config.apiV3Key, Buffer.from(resource.nonce));
  decipher.setAuthTag(ciphertext.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  const data = z
    .object({
      appid: z.literal(config.appId),
      mchid: z.literal(config.merchantId),
      trade_state: z.literal("SUCCESS"),
      out_trade_no: z.string().min(1).max(64),
      transaction_id: z.string().min(1).max(64),
      amount: z.object({ total: z.number().int().positive(), currency: z.literal("CNY") }),
    })
    .parse(JSON.parse(plaintext.toString()));

  return {
    provider: "wechat",
    outTradeNo: data.out_trade_no,
    tradeNo: data.transaction_id,
    amountFen: data.amount.total,
    currency: data.amount.currency,
    dedupeKey: envelope.id,
  };
}

/** 将格式、解密和验签异常统一为不可接受的通知，不泄露原始载荷。 */
export function verifyNotification(
  provider: LoginProvider,
  raw: string,
  headers: Headers,
  config: NotificationConfig,
): PaymentNotice {
  try {
    if (Buffer.byteLength(raw) > 65_536) {
      throw new AppError("PAYMENT_INVALID");
    }

    return provider === "alipay" ? alipayNotice(raw, config) : wechatNotice(raw, headers, config);
  } catch (cause) {
    throw new AppError("PAYMENT_INVALID", undefined, { cause });
  }
}

/** 支付宝沙箱和模拟通知共用 RSA2 验签，不需要微信配置。 */
export function verifyAlipayNotification(
  raw: string,
  config: Pick<NotificationConfig, "publicKey" | "appId" | "merchantId">,
): PaymentNotice {
  try {
    if (Buffer.byteLength(raw) > 65_536) {
      throw new AppError("PAYMENT_INVALID");
    }

    return alipayNotice(raw, config);
  } catch (cause) {
    throw new AppError("PAYMENT_INVALID", undefined, { cause });
  }
}

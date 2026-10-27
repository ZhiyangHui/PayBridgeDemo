import { createDecipheriv, verify } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { parseMoney } from "../orders/money";
import type { LoginProvider } from "../auth/types";

/** 验证支付通知所需的公钥、解密密钥和收款身份。 */
export type NotificationConfig = {
  /** 用于验证平台通知签名的 RSA 公钥。 */
  publicKey: string;
  /** 微信通知资源的 AES 解密密钥，长度为 32 字节。 */
  apiV3Key: Buffer;
  /** 通知中必须匹配的收款应用 ID。 */
  appId: string;
  /** 通知中必须匹配的收款商户 ID。 */
  merchantId: string;
  /** 微信请求头中必须匹配的验签公钥或证书标识。 */
  serial: string;
};

/** 通过校验后交给订单模块处理的支付结果。 */
export type PaymentNotice = {
  provider: LoginProvider;
  /** 本站创建并提交给支付平台的商户订单号。 */
  outTradeNo: string;
  /** 支付平台返回的交易号。 */
  tradeNo: string;
  /** 本次交易的总金额，单位为分。 */
  amountFen: number;
  currency: "CNY";
  /** 通知或查单结果的唯一标识，用于记录已处理结果。 */
  dedupeKey: string;
  /** 省略时按已支付处理；沙箱查单或通知也可返回已关闭。 */
  status?: "paid" | "closed";
};

/**
 * 生成支付宝通知的待验签字符串。
 * 去掉 sign、sign_type 和空值，将剩余字段按名称排序并以 & 连接。
 * @param fields 已解码的表单字段，不在此处重新进行 URL 编码。
 */
export function alipaySigningText(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== "sign" && key !== "sign_type" && fields[key] !== "")
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
}

/**
 * 检查 Base64 签名格式，并用给定 RSA 公钥验证文本签名。
 * @returns 格式合法且 SHA256 签名验证通过时返回 true，否则返回 false。
 * @throws 公钥无法解析等底层加密异常会向上抛出。
 */
function validSignature(text: string, signature: string, publicKey: string): boolean {
  const bytes = Buffer.from(signature, "base64");

  return (
    bytes.toString("base64") === signature &&
    verify("RSA-SHA256", Buffer.from(text), publicKey, bytes)
  );
}

/**
 * 解析支付宝表单通知，验证 RSA2 签名、应用 ID 和收款商户。
 * @returns 订单号、交易号、分金额、通知标识和支付状态。
 * @throws 签名错误抛出 PAYMENT_INVALID；字段格式错误交给外层统一处理。
 */
function alipayNotice(
  raw: string,
  config: Pick<NotificationConfig, "publicKey" | "appId" | "merchantId">,
): PaymentNotice {
  const params = new URLSearchParams(raw);
  const fields = Object.fromEntries(params);

  // 拒绝重复字段、非 RSA2 签名以及被篡改的表单。
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

/**
 * 验证微信支付通知签名，解密交易数据并核对应用和商户。
 * 校验通知时间、验签公钥标识、事件类型以及解密后的金额和状态。
 * @returns 用于更新订单的支付结果；这里只接受交易成功通知。
 * @throws 验签、解密或字段校验失败时向上抛出。
 */
function wechatNotice(raw: string, headers: Headers, config: NotificationConfig): PaymentNotice {
  // 从请求头读取微信签名参数，验签时使用未经修改的原始正文。
  const timestamp = headers.get("Wechatpay-Timestamp") ?? "";
  const nonce = headers.get("Wechatpay-Nonce") ?? "";
  const signature = headers.get("Wechatpay-Signature") ?? "";

  // 拒绝超过五分钟的通知、缺少随机值、未知公钥标识或无效签名。
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !nonce ||
    headers.get("Wechatpay-Serial") !== config.serial ||
    !validSignature(`${timestamp}\n${nonce}\n${raw}\n`, signature, config.publicKey)
  ) {
    throw new AppError("PAYMENT_INVALID");
  }

  // 签名通过后检查通知类型及加密资源格式。
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
  // 密文末尾 16 字节是 GCM 认证标签，其余部分是待解密内容。
  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", config.apiV3Key, Buffer.from(resource.nonce));
  decipher.setAuthTag(ciphertext.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  // 解密后核对应用、商户、交易成功状态和以分为单位的金额。
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

/**
 * 按支付渠道解析并验证原始通知，返回统一的支付结果。
 * @param raw 未修改的原始请求正文，最大 65536 字节。
 * @param headers 微信验签所需的时间、随机值、公钥标识和签名请求头。
 * @throws AppError 正文过大、格式错误、解密失败或验签失败均抛出 PAYMENT_INVALID。
 */
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

/**
 * 使用支付宝公钥及商户配置验证一条原始表单通知。
 * @returns 验证后的支付结果，不更新订单。
 * @throws AppError 正文过大或任何验证失败时抛出 PAYMENT_INVALID。
 */
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

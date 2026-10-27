import { createCipheriv, randomBytes, sign } from "node:crypto";
import type { Order } from "../../generated/prisma/client";
import { alipaySigningText, type NotificationConfig } from "./notification";
import { formatMoney } from "../orders/money";

/** 模拟平台独立持有测试私钥，真实配置不引用它。 */
export type MockPaymentKeys = NotificationConfig & { privateKey: string };

/**
 * 根据模拟订单生成对应平台格式的支付成功通知。
 * 支付宝生成 RSA2 签名表单；微信生成 AES-GCM 加密资源及 RSA 签名请求头。
 * @param order 用于生成订单号、金额和渠道的数据库订单。
 * @param keys 本地测试密钥及模拟应用、商户标识。
 * @returns 通知原始正文及请求头，供共用通知处理器验证。
 */
export function mockPaymentNotification(
  order: Order,
  keys: MockPaymentKeys,
): { body: string; headers: Headers } {
  // 交易号和通知标识固定关联本站订单，重复模拟付款仍表示同一笔交易。
  const tradeNo = `mock_${order.id}`;

  if (order.provider === "alipay") {
    const fields: Record<string, string> = {
      app_id: keys.appId,
      seller_id: keys.merchantId,
      out_trade_no: order.outTradeNo,
      trade_no: tradeNo,
      notify_id: tradeNo,
      total_amount: formatMoney(order.amountFen),
      trade_status: "TRADE_SUCCESS",
      sign_type: "RSA2",
    };
    // 对排序后的支付宝通知字段签名，再编码成表单正文。
    fields.sign = sign(
      "RSA-SHA256",
      Buffer.from(alipaySigningText(fields)),
      keys.privateKey,
    ).toString("base64");

    return {
      body: new URLSearchParams(fields).toString(),
      headers: new Headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    };
  }

  // 为微信资源生成 12 字节随机字符串，并设置加密关联数据。
  const nonce = randomBytes(6).toString("hex");
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", keys.apiV3Key, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const plaintext = JSON.stringify({
    appid: keys.appId,
    mchid: keys.merchantId,
    out_trade_no: order.outTradeNo,
    transaction_id: tradeNo,
    trade_state: "SUCCESS",
    amount: { total: order.amountFen, currency: order.currency },
  });
  // 将交易 JSON 加密，认证标签附加在密文末尾，再进行 Base64 编码。
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const body = JSON.stringify({
    id: tradeNo,
    event_type: "TRANSACTION.SUCCESS",
    resource: {
      algorithm: "AEAD_AES_256_GCM",
      ciphertext: encrypted.toString("base64"),
      nonce,
      associated_data: associatedData,
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  // 对微信通知的时间戳、随机值及原始 JSON 正文签名，行末也保留换行。
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    keys.privateKey,
  ).toString("base64");

  return {
    body,
    headers: new Headers({
      "Content-Type": "application/json",
      "Wechatpay-Timestamp": timestamp,
      "Wechatpay-Nonce": nonce,
      "Wechatpay-Serial": keys.serial,
      "Wechatpay-Signature": signature,
    }),
  };
}

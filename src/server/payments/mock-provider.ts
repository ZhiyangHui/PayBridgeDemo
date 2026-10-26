import { createCipheriv, randomBytes, sign } from "node:crypto";
import type { Order } from "../../generated/prisma/client";
import { alipaySigningText, type NotificationConfig } from "./notification";
import { formatMoney } from "../orders/money";

/** 模拟平台独立持有测试私钥，真实配置不引用它。 */
export type MockPaymentKeys = NotificationConfig & { privateKey: string };

/** 模拟付款产生平台格式的已签名通知，交易号按订单固定以便重试。 */
export function mockPaymentNotification(
  order: Order,
  keys: MockPaymentKeys,
): { body: string; headers: Headers } {
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

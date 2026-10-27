import "server-only";
import { randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import { verifyWechatSignature, type NotificationConfig } from "./notification";

/** 微信 Native 支付所需的商户身份、签名私钥和平台验签公钥。 */
export type WechatPaymentConfig = NotificationConfig & {
  /** 商户 API 证书私钥，用于签名出站请求。 */
  privateKey: string;
  /** 商户 API 证书序列号，与平台公钥 ID 是两个不同字段。 */
  certificateSerial: string;
  notifyUrl: string;
};

/** 读取已启用的微信正式支付配置；凭据留空时不能发起请求。 */
export function wechatPaymentConfig(): WechatPaymentConfig {
  if (getEnv().WECHAT_MODE !== "live") {
    throw new AppError("PAYMENT_UNAVAILABLE");
  }

  try {
    return {
      appId: process.env.WECHAT_PAY_APP_ID!,
      merchantId: process.env.WECHAT_PAY_MCH_ID!,
      apiV3Key: Buffer.from(process.env.WECHAT_PAY_API_V3_KEY!, "utf8"),
      privateKey: readFileSync(process.env.WECHAT_PAY_PRIVATE_KEY_PATH!, "utf8"),
      publicKey: readFileSync(process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH!, "utf8"),
      certificateSerial: process.env.WECHAT_PAY_CERT_SERIAL_NO!,
      serial: process.env.WECHAT_PAY_PLATFORM_KEY_ID!,
      notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL!,
    };
  } catch (cause) {
    throw new AppError("CONFIG_ERROR", "无法读取微信支付密钥文件", { cause });
  }
}

/** 微信支付返回的业务错误，保留状态和错误码供下单、查单分别处理。 */
export class WechatApiError extends AppError {
  /** 保存已验证响应中的错误码；不保存平台正文、用户资料或签名。 */
  constructor(
    readonly providerCode: string,
    readonly status: number,
  ) {
    super("PAYMENT_PROVIDER_ERROR");
  }
}

/**
 * 为微信 API v3 请求生成商户签名。
 * @param path 含查询参数的路径；必须与实际发送的 URL 完全相同。
 * @param body 实际发送的 JSON 字符串；GET 请求传空字符串。
 */
function authorization(
  method: string,
  path: string,
  body: string,
  config: WechatPaymentConfig,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = sign("RSA-SHA256", Buffer.from(message), config.privateKey).toString("base64");

  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.certificateSerial}",signature="${signature}"`;
}

/**
 * 向微信支付发送签名请求，验证原始响应后返回业务数据。
 * 请求和读取正文合计最多等待八秒，不自动重发下单请求。
 * @throws AppError 网络、超时和验签错误保持明确分类；平台业务错误抛出 WechatApiError。
 */
export async function wechatPayRequest<T>(
  method: "GET" | "POST",
  path: string,
  data: Record<string, unknown> | undefined,
  schema: z.ZodType<T>,
  config: WechatPaymentConfig,
): Promise<T> {
  const body = data ? JSON.stringify(data) : "";
  const signal = AbortSignal.timeout(8000);

  try {
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      headers: {
        Authorization: authorization(method, path, body, config),
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PayBridgeDemo/0.1",
        "Wechatpay-Serial": config.serial,
      },
      body: method === "POST" ? body : undefined,
      signal,
      redirect: "error",
      cache: "no-store",
    });
    const raw = await response.text();

    // 必须先验签再解析业务字段；HTTP 200 本身不能证明付款结果可信。
    verifyWechatSignature(raw, response.headers, config);
    const payload: unknown = JSON.parse(raw);

    if (!response.ok) {
      const error = z.object({ code: z.string().regex(/^[A-Z0-9_]{1,80}$/) }).parse(payload);
      console.error(
        JSON.stringify({
          event: "wechat_payment_failure",
          status: response.status,
          code: error.code,
        }),
      );
      throw new WechatApiError(error.code, response.status);
    }

    return schema.parse(payload);
  } catch (cause) {
    if (cause instanceof AppError) {
      throw cause;
    }

    if (signal.aborted) {
      throw new AppError("UPSTREAM_TIMEOUT", undefined, { cause });
    }

    const code = cause instanceof TypeError ? "UPSTREAM_NETWORK" : "UPSTREAM_RESPONSE";
    throw new AppError(code, undefined, { cause });
  }
}

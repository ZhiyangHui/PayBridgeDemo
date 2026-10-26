import "server-only";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import type { MockPaymentKeys } from "./mock-provider";

/** 为模拟通知保存独立测试密钥；不读取或替换支付宝真实密钥。 */
export function getMockPaymentKeys(): MockPaymentKeys {
  if (getEnv().PAYMENT_MODE !== "mock") {
    throw new AppError("MOCK_ONLY");
  }

  const file = ".local/mock-payment-keys.json";
  mkdirSync(".local", { recursive: true });

  if (!existsSync(file)) {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(file, JSON.stringify({ ...pair, apiV3Key: randomBytes(32).toString("hex") }), {
      mode: 0o600,
    });
  }

  const keys = JSON.parse(readFileSync(file, "utf8"));

  return {
    ...keys,
    apiV3Key: Buffer.from(keys.apiV3Key, "hex"),
    appId: "paybridge_mock",
    merchantId: "paybridge_mock_merchant",
    serial: "PAYBRIDGE_MOCK",
  };
}

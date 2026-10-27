import "server-only";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getEnv } from "../config/env";
import { AppError } from "../errors/app-error";
import type { MockPaymentKeys } from "./mock-provider";

/**
 * 读取本地模拟支付密钥，文件不存在时生成并保存一套测试密钥。
 * 返回 RSA 公私钥、32 字节 AES 密钥和固定的模拟商户标识。
 * @throws AppError 全站 PAYMENT_MODE 不是 mock 时抛出 MOCK_ONLY；文件读取和解析异常继续上抛。
 */
export function getMockPaymentKeys(): MockPaymentKeys {
  if (getEnv().PAYMENT_MODE !== "mock") {
    throw new AppError("MOCK_ONLY");
  }

  const file = ".local/mock-payment-keys.json";
  mkdirSync(".local", { recursive: true });

  // 首次使用时生成 RSA 和 AES 密钥，文件仅允许当前用户读写。
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

  // 后续使用同一套测试密钥，将保存的十六进制 AES 密钥还原为字节。
  const keys = JSON.parse(readFileSync(file, "utf8"));

  return {
    ...keys,
    apiV3Key: Buffer.from(keys.apiV3Key, "hex"),
    appId: "paybridge_mock",
    merchantId: "paybridge_mock_merchant",
    serial: "PAYBRIDGE_MOCK",
  };
}

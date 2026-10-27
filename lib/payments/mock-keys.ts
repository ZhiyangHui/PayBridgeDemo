import "server-only";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { paymentMode } from "./mode";
import type { LoginProvider } from "../auth/types";
import { AppError } from "../errors/app-error";
import type { MockPaymentKeys } from "./mock-provider";

/**
 * 读取本地模拟支付密钥，文件不存在时生成并保存一套测试密钥。
 * 返回 RSA 公私钥、32 字节 AES 密钥和固定的模拟商户标识。
 * @param provider 需要使用测试密钥的支付渠道。
 * @param mode 从后端会话或已验证订单取得的模式；模拟会话可与沙箱配置并存。
 * @throws AppError 该渠道未启用模拟支付时抛出 MOCK_ONLY；文件读取和解析异常继续上抛。
 */
export function getMockPaymentKeys(
  provider: LoginProvider,
  mode: string = paymentMode(provider),
): MockPaymentKeys {
  if (mode !== "mock") {
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

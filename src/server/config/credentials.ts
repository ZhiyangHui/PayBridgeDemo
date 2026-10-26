import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { AppError } from "../errors/app-error";
import { parseEnv } from "./env";

/** 校验 RSA 密钥格式；支持支付宝控制台提供的不带 PEM 头的内容。 */
function validateKey(value: string, privateKey: boolean): void {
  const pem = value.includes("-----BEGIN")
    ? value
    : `-----BEGIN ${privateKey ? "PRIVATE" : "PUBLIC"} KEY-----\n${value}\n-----END ${privateKey ? "PRIVATE" : "PUBLIC"} KEY-----`;
  const key = privateKey ? createPrivateKey(pem) : createPublicKey(pem);

  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("需要至少 2048 位 RSA 密钥");
  }
}

/** 启动时验证真实密钥和文件可读性，模拟模式不会读取证书。 */
export function validateCredentials(source: Record<string, string | undefined>): void {
  const config = parseEnv(source);
  const checks: Array<[string, () => void]> = [];

  if (config.PAYMENT_MODE !== "mock") {
    checks.push(
      ["ALIPAY_PRIVATE_KEY", () => validateKey(source.ALIPAY_PRIVATE_KEY!, true)],
      ["ALIPAY_PUBLIC_KEY", () => validateKey(source.ALIPAY_PUBLIC_KEY!, false)],
    );
  }

  if (config.WECHAT_MODE === "live") {
    checks.push(
      [
        "WECHAT_PAY_PRIVATE_KEY_PATH",
        () => validateKey(readFileSync(source.WECHAT_PAY_PRIVATE_KEY_PATH!, "utf8"), true),
      ],
      [
        "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH",
        () => validateKey(readFileSync(source.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH!, "utf8"), false),
      ],
    );
  }

  for (const [field, check] of checks) {
    try {
      check();
    } catch (cause) {
      throw new AppError("CONFIG_ERROR", `密钥配置有误：${field}`, { cause });
    }
  }
}

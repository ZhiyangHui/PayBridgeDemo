import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { AppError } from "../errors/app-error";
import { parseEnv } from "./env";

/**
 * 解析公钥或私钥，检查其类型为 RSA 且长度至少为 2048 位。
 * @param value PEM 文本或支付宝控制台提供的裸密钥内容。
 * @param privateKey true 检查私钥，false 检查公钥。
 * @throws 密钥无法解析、不是 RSA 或位数不足时抛出异常。
 */
function validateKey(value: string, privateKey: boolean): void {
  // 裸密钥补齐公钥或私钥 PEM 标记，已有 PEM 标记则直接使用。
  const pem = value.includes("-----BEGIN")
    ? value
    : `-----BEGIN ${privateKey ? "PRIVATE" : "PUBLIC"} KEY-----\n${value}\n-----END ${privateKey ? "PRIVATE" : "PUBLIC"} KEY-----`;
  const key = privateKey ? createPrivateKey(pem) : createPublicKey(pem);

  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("需要至少 2048 位 RSA 密钥");
  }
}

/**
 * 根据当前环境校验已启用平台的密钥格式及密钥文件。
 * 支付宝非 mock 模式检查公私钥；微信 live 模式读取并检查指定密钥文件。
 * @throws AppError 环境变量或任一密钥检查失败时抛出 CONFIG_ERROR。
 */
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

  // 逐项执行当前环境的检查，失败时只报告对应的配置名。
  for (const [field, check] of checks) {
    try {
      check();
    } catch (cause) {
      throw new AppError("CONFIG_ERROR", `密钥配置有误：${field}`, { cause });
    }
  }
}

/**
 * 检查支付宝登录需要的 AppID、环境网关、应用私钥和支付宝公钥。
 * @param sandbox 指定本次登录是否使用沙箱网关。
 * @throws AppError 标识、网关或密钥格式不符合要求时抛出 CONFIG_ERROR。
 */
export function validateAlipayLoginCredentials(
  source: Record<string, string | undefined>,
  sandbox: boolean,
): void {
  const gateway = sandbox
    ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
    : "https://openapi.alipay.com/gateway.do";

  if (!/^\d{16,32}$/.test(source.ALIPAY_APP_ID ?? "") || source.ALIPAY_GATEWAY !== gateway) {
    throw new AppError("CONFIG_ERROR", "请检查 ALIPAY_APP_ID 和 ALIPAY_GATEWAY");
  }

  for (const field of ["ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"] as const) {
    try {
      validateKey(source[field] ?? "", field === "ALIPAY_PRIVATE_KEY");
    } catch (cause) {
      throw new AppError("CONFIG_ERROR", `密钥配置有误：${field}`, { cause });
    }
  }
}

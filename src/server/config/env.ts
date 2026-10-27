import { z } from "zod";
import { AppError } from "../errors/app-error";

/** 基础配置与各模式共用字段。 */
const schema = z.object({
  APP_URL: z.url().refine((value) => /^https?:\/\//.test(value)),
  DATABASE_URL: z.string().regex(/^file:.+/),
  PAYMENT_MODE: z.enum(["mock", "sandbox", "live"]),
  ALIPAY_LOGIN_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["mock", "oauth"]).optional(),
  ),
  WECHAT_MODE: z.enum(["mock", "live"]).default("mock"),
  SESSION_SECRET: z
    .string()
    .min(32)
    .refine((value) => !isPlaceholder(value)),
});

/** 仅列出真实接入需要的变量，不要求模拟模式提供真实凭据。 */
const alipayFields = [
  "ALIPAY_APP_ID",
  "ALIPAY_SELLER_ID",
  "ALIPAY_PRIVATE_KEY",
  "ALIPAY_PUBLIC_KEY",
  "ALIPAY_GATEWAY",
  "ALIPAY_NOTIFY_URL",
  "ALIPAY_RETURN_URL",
];
const wechatFields = [
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_CERT_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY_PATH",
  "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH",
  "WECHAT_PAY_NOTIFY_URL",
];

/**
 * 检查配置值是否仍是 replace、your、example 等示例占位内容。
 * 忽略大小写及首尾空白，匹配到占位前缀时返回 true。
 */
function isPlaceholder(value: string): boolean {
  return /^(replace[-_]|your[-_]|change[-_]?me|placeholder|example|todo)/i.test(value.trim());
}

/**
 * 检查字符串是否为允许的 HTTP 或 HTTPS 地址。
 * @param httpsOnly 为 true 时只接受 HTTPS。
 * @returns 地址有效且不含用户名、密码和片段时返回 true；解析失败返回 false。
 */
function validUrl(value: string | undefined, httpsOnly = false): boolean {
  try {
    const url = new URL(value ?? "");

    return (
      (httpsOnly ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol)) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * 读取并校验运行模式、数据库地址、会话密钥及各平台必填配置。
 * 按支付模式决定需要检查的凭据，并补齐微信模式和支付宝登录模式的默认值。
 * @param source 环境变量键值表，通常为 process.env。
 * @returns 可用于业务判断的基础配置，不包含平台私钥等原始凭据。
 * @throws AppError 缺项、占位值或格式错误时抛出 CONFIG_ERROR，提示中只列变量名。
 */
export function parseEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new AppError(
      "CONFIG_ERROR",
      `环境配置有误：${[...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ")}`,
    );
  }

  const config = result.data;
  // 全站 mock 时微信也用 mock；支付宝沙箱模式允许单独选择微信模式。
  const wechatMode = config.PAYMENT_MODE === "sandbox" ? config.WECHAT_MODE : config.PAYMENT_MODE;

  // 仅收集当前启用环境需要的凭据，模拟环境不强制提供真实平台密钥。
  const required = [
    ...(config.PAYMENT_MODE !== "mock" ? alipayFields : []),
    ...(wechatMode === "live" ? wechatFields : []),
  ];
  const invalid = new Set(
    required.filter((key) => !source[key]?.trim() || isPlaceholder(source[key]!)),
  );

  if (!validUrl(config.APP_URL, config.PAYMENT_MODE === "live")) {
    invalid.add("APP_URL");
  }

  // 真实请求必须使用当前支付环境对应的网关，并提供 HTTPS 支付回调地址。
  if (config.PAYMENT_MODE !== "mock") {
    const gateway =
      config.PAYMENT_MODE === "sandbox"
        ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
        : "https://openapi.alipay.com/gateway.do";

    if (source.ALIPAY_GATEWAY !== gateway) {
      invalid.add("ALIPAY_GATEWAY");
    }

    for (const key of ["ALIPAY_NOTIFY_URL", "ALIPAY_RETURN_URL"]) {
      if (!validUrl(source[key], true)) {
        invalid.add(key);
      }
    }
  }

  if (config.PAYMENT_MODE !== "mock" && !/^\d{16,32}$/.test(source.ALIPAY_SELLER_ID ?? "")) {
    invalid.add("ALIPAY_SELLER_ID");
  }

  // 正式支付环境不允许使用支付宝模拟登录。
  if (config.PAYMENT_MODE === "live" && config.ALIPAY_LOGIN_MODE === "mock") {
    invalid.add("ALIPAY_LOGIN_MODE");
  }

  if (wechatMode === "live") {
    if (Buffer.byteLength(source.WECHAT_PAY_API_V3_KEY ?? "", "utf8") !== 32) {
      invalid.add("WECHAT_PAY_API_V3_KEY");
    }

    if (!validUrl(source.WECHAT_PAY_NOTIFY_URL, true)) {
      invalid.add("WECHAT_PAY_NOTIFY_URL");
    }
  }

  // 统一报告所有配置问题，只输出变量名，不打印环境变量的内容。
  if (invalid.size) {
    throw new AppError("CONFIG_ERROR", `环境配置有误：${[...invalid].join(", ")}`);
  }

  return {
    ...config,
    WECHAT_MODE: wechatMode,
    ALIPAY_LOGIN_MODE:
      config.ALIPAY_LOGIN_MODE ?? (config.PAYMENT_MODE === "mock" ? "mock" : "oauth"),
  };
}

/**
 * 校验当前进程的环境变量，返回基础运行配置。
 * @throws AppError 配置不完整或无效时抛出 CONFIG_ERROR。
 */
export function getEnv() {
  return parseEnv(process.env);
}

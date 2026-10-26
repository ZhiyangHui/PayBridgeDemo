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

/** 识别示例占位值，避免把模板配置用于真实接入。 */
function isPlaceholder(value: string): boolean {
  return /^(replace[-_]|your[-_]|change[-_]?me|placeholder|example|todo)/i.test(value.trim());
}

/** 校验回调地址，避免凭据进入 URL，真实通知必须可通过 HTTPS 访问。 */
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

/** 校验模式、必要凭据和网关，错误只列变量名，不回显值。 */
export function parseEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new AppError(
      "CONFIG_ERROR",
      `环境配置有误：${[...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ")}`,
    );
  }

  const config = result.data;
  const wechatMode = config.PAYMENT_MODE === "sandbox" ? config.WECHAT_MODE : config.PAYMENT_MODE;

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

/** 读取服务端环境，禁止向页面传递原始密钥。 */
export function getEnv() {
  return parseEnv(process.env);
}

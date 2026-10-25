import { z } from "zod";
const schema = z.object({
  APP_URL: z.url(),
  DATABASE_URL: z.string().startsWith("file:"),
  PAYMENT_MODE: z.enum(["mock", "sandbox", "live"]),
  WECHAT_MODE: z.enum(["mock", "live"]).default("mock"),
  SESSION_SECRET: z.string().min(32),
});
export function parseEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`环境配置有误：${result.error.issues.map(i => i.path.join(".")).join(", ")}`);
  const config = result.data;
  const required: string[] = [];
  if (config.PAYMENT_MODE !== "mock") {
    required.push("ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_GATEWAY", "ALIPAY_NOTIFY_URL", "ALIPAY_RETURN_URL");
    if (config.SESSION_SECRET.startsWith("replace-")) throw new Error("请配置随机 SESSION_SECRET");
  }
  if (config.PAYMENT_MODE === "live" || (config.PAYMENT_MODE === "sandbox" && config.WECHAT_MODE === "live")) {
    required.push("WECHAT_APP_ID", "WECHAT_APP_SECRET", "WECHAT_PAY_MCH_ID", "WECHAT_PAY_APP_ID", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_CERT_SERIAL_NO", "WECHAT_PAY_PRIVATE_KEY_PATH", "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH", "WECHAT_PAY_NOTIFY_URL");
  }
  const missing = required.filter(key => !source[key]?.trim());
  if (missing.length) throw new Error(`缺少环境变量：${missing.join(", ")}`);
  return config;
}
export function getEnv() { return parseEnv(process.env); }

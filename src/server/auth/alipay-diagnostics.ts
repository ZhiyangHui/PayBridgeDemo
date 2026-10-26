import "server-only";
import type { AlipaySdk } from "alipay-sdk";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";

/** 去掉错误说明中的凭据、URL 和身份数据，只保留有助排查的短文本。 */
export function redactAlipayMessage(value: unknown, secrets: string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  let text = value;

  for (const secret of secrets.filter(Boolean)) {
    for (const variant of [secret, encodeURIComponent(secret)]) {
      text = text.split(variant).join("[redacted]");
    }
  }

  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+/g, "[email]")
    .replace(
      /(?:access_token|refresh_token|auth_token|auth_code|private_key|sign)\s*[=:]\s*[^\s,;]+/gi,
      "[credential]",
    )
    .replace(/[A-Za-z0-9_+/=-]{16,}/g, "[redacted]")
    .replace(/\d{7,}/g, "[number]")
    .slice(0, 300);
}

/** 仅本地沙箱诊断时，对同一令牌额外执行一次只读表单查询；结果不替代登录判断。 */
export async function diagnoseAlipayProfile(
  sdk: AlipaySdk,
  token: string,
  code: string,
  original: Record<string, unknown>,
): Promise<void> {
  if (
    process.env.PAYMENT_MODE !== "sandbox" ||
    process.env.NODE_ENV === "production" ||
    process.env.ALIPAY_DIAGNOSTICS !== "1"
  ) {
    return;
  }

  const runId = randomUUID();
  const secrets = [
    token,
    code,
    process.env.ALIPAY_PRIVATE_KEY ?? "",
    process.env.SESSION_SECRET ?? "",
  ];

  /** 只输出选定诊断字段，绝不序列化请求或完整响应。 */
  const record = (
    transport: string,
    data: Record<string, unknown>,
    status?: number,
    verified = true,
  ) => {
    const entry = {
      event: "alipay_profile_diagnostic",
      time: new Date().toISOString(),
      runId,
      transport,
      status,
      verified,
      code: typeof data.code === "string" && /^\d{5}$/.test(data.code) ? data.code : undefined,
      subCode:
        typeof data.sub_code === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(data.sub_code)
          ? data.sub_code
          : undefined,
      traceId:
        typeof data.traceId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(data.traceId)
          ? data.traceId
          : undefined,
      message: redactAlipayMessage(data.msg, secrets),
      detail: redactAlipayMessage(data.sub_msg, secrets),
    };
    const line = JSON.stringify(entry);
    console.info(line);

    try {
      mkdirSync(".local", { recursive: true });
      appendFileSync(".local/alipay-diagnostics.jsonl", line + "\n", { mode: 0o600 });
    } catch {
      console.warn("支付宝诊断文件写入失败，请查看终端中的脱敏记录。");
    }
  };

  record("sdk", original, 200);
  // SDK 负责签名；对照请求把相同参数统一放入表单正文，不再拆到 URL。
  let status: number | undefined;

  try {
    const response = await fetch(sdk.config.gateway!, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: sdk.sdkExecute("alipay.user.info.share", { authToken: token }),
    });
    status = response.status;

    if (!response.ok) {
      record("form", { msg: "HTTP 请求失败" }, status, false);

      return;
    }

    const raw = await response.text();
    const envelope = JSON.parse(raw);
    const responseKey = envelope.alipay_user_info_share_response
      ? "alipay_user_info_share_response"
      : "error_response";
    sdk.checkResponseSign(raw, responseKey, envelope.sign, response.headers.get("trace_id") ?? "");
    record("form", { ...envelope[responseKey], traceId: response.headers.get("trace_id") }, status);
  } catch {
    // SDK 的异常消息可能含签名和响应正文，不能直接输出。
    record("form", { msg: "请求、解析或验签失败" }, status, false);
  }
}

import { z } from "zod";
import { AppError } from "../errors/app-error";

/** 平台请求只接收可重复发送的字符串正文；默认不重试。 */
type RequestOptions = {
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
};

/** 限制等待和重试；写入请求一律不自动重发，避免重复扣款。 */
const optionsSchema = z.object({
  timeoutMs: z.number().int().min(1).max(30_000),
  retries: z.number().int().min(0).max(2),
});

/** 在超时范围内读取和校验 JSON，仅 GET 的暂时性网络错误允许重试。 */
export async function requestJson<T>(url: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retries = options.retries ?? 0;
  if (!optionsSchema.safeParse({ timeoutMs, retries }).success || (method !== "GET" && retries > 0)) {
    throw new AppError("INVALID_INPUT", "请求超时或重试配置有误，POST 不允许自动重试");
  }
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      signal.throwIfAborted();
      const response = await fetch(url, { method, headers: options.headers, body: options.body, signal, redirect: "error" });
      if (!response.ok) {
        throw new AppError("UPSTREAM_RESPONSE", `平台 HTTP 状态：${response.status}`);
      }
      // 超时覆盖响应正文读取，HTTP 200 也必须通过平台响应结构校验。
      const result = schema.safeParse(await response.json());
      if (!result.success) throw new AppError("UPSTREAM_RESPONSE", "平台响应结构不符合预期");
      return result.data;
    } catch (cause) {
      if (options.signal?.aborted) throw new AppError("REQUEST_CANCELLED", undefined, { cause });
      const error = controller.signal.aborted
        ? new AppError("UPSTREAM_TIMEOUT", undefined, { cause })
        : cause instanceof AppError ? cause
        : new AppError(cause instanceof SyntaxError ? "UPSTREAM_RESPONSE" : "UPSTREAM_NETWORK", undefined, { cause });
      if (attempt >= retries || !["UPSTREAM_TIMEOUT", "UPSTREAM_NETWORK"].includes(error.code)) throw error;
    } finally {
      clearTimeout(timer);
    }
    // 两次重试最多等待 100ms、200ms，避免故障时连续请求平台。
    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
}

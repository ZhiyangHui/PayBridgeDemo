import { z } from "zod";
import { AppError } from "../errors/app-error";

/** 平台请求只接收可重复发送的字符串正文；默认不重试。 */
type RequestOptions = {
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: string;
  /** 单次请求超时，单位毫秒，默认 8000，最大 30000。 */
  timeoutMs?: number;
  /** 首次失败后的额外尝试次数，默认 0，仅 GET 可设为 1 或 2。 */
  retries?: number;
  /** 调用方提供的取消信号，取消后不重试。 */
  signal?: AbortSignal;
};

/** 限制等待和重试；写入请求一律不自动重发，避免重复扣款。 */
const optionsSchema = z.object({
  timeoutMs: z.number().int().min(1).max(30_000),
  retries: z.number().int().min(0).max(2),
});

/**
 * 发送 HTTP 请求，读取 JSON 并使用传入的 Zod 规则校验响应。
 * @param schema 响应数据的校验规则，验证通过后返回其解析结果。
 * @param options 请求方法、正文、超时毫秒数、重试次数和外部取消信号。
 * 仅 GET 的网络错误和超时可重试，最多两次；POST 不自动重发。
 * @throws AppError 参数错误为 INVALID_INPUT；取消、超时、网络和响应错误分别使用对应错误码。
 */
export async function requestJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retries = options.retries ?? 0;

  if (
    !optionsSchema.safeParse({ timeoutMs, retries }).success ||
    (method !== "GET" && retries > 0)
  ) {
    throw new AppError("INVALID_INPUT", "请求超时或重试配置有误，POST 不允许自动重试");
  }

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 合并超时与调用方取消信号，任何一个触发都会终止本次请求。
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

    try {
      signal.throwIfAborted();
      const response = await fetch(url, {
        method,
        headers: options.headers,
        body: options.body,
        signal,
        redirect: "error",
      });

      if (!response.ok) {
        throw new AppError("UPSTREAM_RESPONSE", `平台 HTTP 状态：${response.status}`);
      }

      // 超时覆盖响应正文读取，HTTP 200 也必须通过平台响应结构校验。
      const result = schema.safeParse(await response.json());

      if (!result.success) {
        throw new AppError("UPSTREAM_RESPONSE", "平台响应结构不符合预期");
      }

      return result.data;
    } catch (cause) {
      // 调用方主动取消优先处理，不进入网络错误重试。
      if (options.signal?.aborted) {
        throw new AppError("REQUEST_CANCELLED", undefined, { cause });
      }

      let error: AppError;

      // 根据超时、已分类业务错误、JSON 解析错误和网络错误分别包装异常。
      if (controller.signal.aborted) {
        error = new AppError("UPSTREAM_TIMEOUT", undefined, { cause });
      } else if (cause instanceof AppError) {
        error = cause;
      } else {
        const code = cause instanceof SyntaxError ? "UPSTREAM_RESPONSE" : "UPSTREAM_NETWORK";
        error = new AppError(code, undefined, { cause });
      }

      // 重试次数用完，或错误不是超时和网络失败时，立即向上抛出。
      if (attempt >= retries || !["UPSTREAM_TIMEOUT", "UPSTREAM_NETWORK"].includes(error.code)) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }

    // 两次重试最多等待 100ms、200ms，避免故障时连续请求平台。
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
}

import { randomUUID } from "node:crypto";
import { AppError, errorDefinitions } from "./app-error";

/**
 * 将异常转换成包含错误码、固定提示和追踪编号的 JSON 响应。
 * 已知业务错误使用对应 HTTP 状态，其他异常统一转换为 INTERNAL_ERROR。
 * 同时输出脱敏日志，响应禁止缓存；支付通知接口另行返回平台要求的格式。
 */
export function errorResponse(cause: unknown): Response {
  const error =
    cause instanceof AppError ? cause : new AppError("INTERNAL_ERROR", undefined, { cause });
  const [status, message] = errorDefinitions[error.code];
  const requestId = randomUUID();
  // 只记录固定字段，不序列化异常正文、请求参数或第三方响应中的秘密。
  console.error(JSON.stringify({ event: "api_error", requestId, code: error.code, status }));

  return Response.json(
    { error: { code: error.code, message, requestId } },
    {
      status,
      headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" },
    },
  );
}

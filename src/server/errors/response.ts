import { randomUUID } from "node:crypto";
import { AppError, errorDefinitions } from "./app-error";

/** 将普通 API 错误转换为安全响应；支付 notify 需使用各平台专用响应。 */
export function errorResponse(cause: unknown): Response {
  const error = cause instanceof AppError ? cause : new AppError("INTERNAL_ERROR", undefined, { cause });
  const [status, message] = errorDefinitions[error.code];
  const requestId = randomUUID();
  // 只记录固定字段，不序列化异常正文、请求参数或第三方响应中的秘密。
  console.error(JSON.stringify({ event: "api_error", requestId, code: error.code, status }));
  return Response.json({ error: { code: error.code, message, requestId } }, {
    status, headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" },
  });
}

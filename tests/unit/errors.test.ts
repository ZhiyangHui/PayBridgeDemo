import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../lib/errors/app-error";
import { errorResponse } from "../../lib/errors/response";

afterEach(() => vi.restoreAllMocks());

describe("错误边界", () => {
  it("保留原因但响应和日志都不泄露秘密", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("token=secret-value");
    const error = new AppError("DATABASE_ERROR", "private-key", { cause });
    const response = errorResponse(error);
    const body = await response.json();
    expect(error.cause).toBe(cause);
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Request-Id")).toBe(body.error.requestId);
    expect(JSON.stringify([body, logger.mock.calls])).not.toMatch(/secret-value|private-key/);
    expect(logger).toHaveBeenCalledOnce();
  });
  it("未知异常统一兜底", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse({ password: "hidden" });
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

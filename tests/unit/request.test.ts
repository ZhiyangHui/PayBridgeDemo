import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestJson } from "../../lib/http/request";

const schema = z.object({ ok: z.boolean() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("平台请求保护", () => {
  it("解析并校验响应", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestJson("https://demo.test", schema)).toEqual({ ok: true });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("POST 网络失败不自动重试", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestJson("https://demo.test", schema, { method: "POST" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_NETWORK" });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      requestJson("https://demo.test", schema, { method: "POST", retries: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("GET 只进行配置次数的重试", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("https://demo.test", schema, { retries: 2 })).rejects.toMatchObject({
      code: "UPSTREAM_NETWORK",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("HTTP 错误和响应格式错误不盲目重试", async () => {
    for (const response of [
      new Response("private upstream data", { status: 500 }),
      Response.json({ invalid: true }),
      new Response("not json"),
    ]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetcher);
      await expect(requestJson("https://demo.test", schema, { retries: 2 })).rejects.toMatchObject({
        code: "UPSTREAM_RESPONSE",
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("超时覆盖响应正文读取", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            }),
          ),
      })),
    );
    await expect(requestJson("https://demo.test", schema, { timeoutMs: 10 })).rejects.toMatchObject(
      { code: "UPSTREAM_TIMEOUT" },
    );
  });
  it("已经取消的请求不访问平台", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestJson("https://demo.test", schema, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("主动取消不重试", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw new Error("cancel");
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestJson("https://demo.test", schema, { signal: controller.signal, retries: 2 }),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchOrder, type PollState } from "../../lib/orders/polling";

const states: PollState[] = [];
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  states.length = 0;
});

afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** 模拟服务器响应，不调用支付平台或使用真实订单。 */
function reply(status: string) {
  return new Response(JSON.stringify({ status }));
}

/** 启动实际轮询器，记录页面会收到的状态。 */
async function start() {
  stop = watchOrder("own-order", (state) => states.push(state));
  await vi.advanceTimersByTimeAsync(0);
}

describe("订单状态轮询", () => {
  it("立即查询，待付款继续查，结束后只刷新一次", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(reply("pending"))
      .mockResolvedValueOnce(reply("paid"));
    await start();
    expect(states.at(-1)).toBe("waiting");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states.filter((state) => state === "complete")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("连续三次失败暂停；手动重新开始后可以查到结果", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("paused");
    stop?.();
    request.mockResolvedValue(reply("paid"));
    await start();
    expect(states.at(-1)).toBe("complete");
  });

  it.each([
    [401, "unauthenticated"],
    [403, "missing"],
    [404, "missing"],
  ] as const)("%s 不继续刷请求", async (status, state) => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
    await start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states.at(-1)).toBe(state);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("未知状态不会被当作付款完成", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply("unknown"));
    await start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states).not.toContain("complete");
    expect(states.at(-1)).toBe("paused");
  });

  it("等待五分钟暂停，不改变订单状态", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply("pending"));
    await start();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(states.at(-1)).toBe("paused");
    expect(states).not.toContain("complete");
  });

  it("取消会中止慢请求，返回结果后也不再更新页面", async () => {
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
      signal = options?.signal;

      return new Promise((done) => {
        resolve = done;
      });
    });
    await start();
    stop?.();
    expect(signal?.aborted).toBe(true);
    resolve(reply("paid"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states).toEqual(["checking"]);
  });
});

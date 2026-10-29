/** 订单查询在页面上展示的状态；查询失败不等于付款失败。 */
export type PollState =
  "checking" | "waiting" | "retrying" | "paused" | "unauthenticated" | "missing" | "complete";

/**
 * 查询本人订单，结束后通知页面刷新；连续失败三次或等待五分钟后暂停。
 * 每次请求最多十秒，离开页面会取消请求和定时器，不修改订单付款状态。
 * @returns 停止查询的方法，供组件卸载或手动重试时调用。
 */
export function watchOrder(id: string, update: (state: PollState) => void): () => void {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  let failures = 0;

  /** 完成一次查询，再安排下一次；慢请求不会重叠。 */
  async function poll() {
    update("checking");

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        cache: "no-store",
      });

      if (controller.signal.aborted) {
        return;
      }

      // 登录过期和订单无权访问不会通过重复请求恢复，交给用户重新登录或返回列表。
      if (response.status === 401 || response.status === 404 || response.status === 403) {
        update(response.status === 401 ? "unauthenticated" : "missing");

        return;
      }

      if (!response.ok) {
        throw new Error("Order query failed");
      }

      const order: unknown = await response.json();

      if (controller.signal.aborted) {
        return;
      }

      if (
        !order ||
        typeof order !== "object" ||
        !("status" in order) ||
        !["pending", "paid", "closed", "failed", "refunded"].includes(String(order.status))
      ) {
        throw new Error("Invalid order status");
      }

      if (order.status !== "pending") {
        update("complete");

        return;
      }

      failures = 0;
      update("waiting");
    } catch {
      if (controller.signal.aborted) {
        return;
      }

      failures += 1;
      update("retrying");
    }

    // 暂停只结束浏览器轮询，不把订单改成失败，也不引导重复付款。
    if (failures >= 3 || Date.now() - startedAt >= 5 * 60_000) {
      update("paused");

      return;
    }

    timer = setTimeout(() => void poll(), 3000);
  }

  void poll();

  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}

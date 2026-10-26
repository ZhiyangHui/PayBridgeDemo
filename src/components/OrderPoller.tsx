"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** 待付款期间读取服务端状态，状态变化后刷新页面，离开页面停止请求。 */
export function OrderPoller({ id }: { id: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    /** 串行轮询避免慢网络下叠加请求。 */
    async function poll() {
      try {
        const response = await fetch(`/api/orders/${id}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("读取订单失败");
        }

        const order = await response.json();
        setFailed(false);

        if (order.status !== "pending") {
          router.refresh();

          return;
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setFailed(true);
      }

      timer = setTimeout(poll, 3000);
    }

    timer = setTimeout(poll, 3000);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, router]);

  return failed ? <p role="status">状态更新失败，正在重试。</p> : null;
}

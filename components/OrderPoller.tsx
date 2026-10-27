"use client";

import { useTranslations } from "@/components/LanguageProvider";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 每三秒读取一次订单状态，状态不再是 pending 时刷新页面。
 * 读取失败时显示重试提示并继续轮询，组件卸载时取消请求及定时器。
 * @param id 当前页面所展示的本站订单 ID。
 */
export function OrderPoller({ id }: { id: string }) {
  const { t } = useTranslations();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    /** 查询一次订单状态；结束则刷新页面，未结束或请求失败则安排下一轮。 */
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

        // 已付款、失败或关闭时停止轮询，让服务端重新渲染最新订单内容。
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

      // 上一次请求结束后再安排下一次查询，避免慢请求相互叠加。
      timer = setTimeout(poll, 3000);
    }

    timer = setTimeout(poll, 3000);

    // 离开页面时中止正在进行的查询，并清除尚未执行的轮询。
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, router]);

  return failed ? <p role="status">{t("状态更新失败，正在重试。")}</p> : null;
}

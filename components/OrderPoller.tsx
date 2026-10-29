"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/components/LanguageProvider";
import { watchOrder, type PollState } from "@/lib/orders/polling";
import styles from "./shop.module.css";

/** 显示查单进度和手动重试入口，付款状态变化后更新订单详情。 */
export function OrderPoller({ id }: { id: string }) {
  const { t } = useTranslations();
  const router = useRouter();
  const [state, setState] = useState<PollState>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      watchOrder(id, (next) => {
        setState(next);

        if (next === "complete") {
          router.refresh();
        }
      }),
    [id, router, attempt],
  );

  const messages: Record<PollState, string> = {
    checking: "正在查询付款结果…",
    waiting: "付款后会自动更新，也可以手动查询。",
    retrying: "状态更新失败，正在重试。",
    paused: "自动查询已暂停。若已付款，请重新查询，不要重复付款。",
    unauthenticated: "登录已过期，请重新登录后到历史订单查看结果。",
    missing: "无法读取此订单，请返回历史订单。",
    complete: "已获取付款结果，正在更新页面…",
  };

  return (
    <div className={styles.poller}>
      <p className={styles.muted} role="status">
        {t(messages[state])}
      </p>
      {state === "unauthenticated" && <Link href="/">{t("返回首页重新登录")}</Link>}
      {state === "missing" && <Link href="/orders">{t("历史订单")}</Link>}
      {state !== "unauthenticated" && state !== "missing" && (
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          disabled={state === "checking" || state === "complete"}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t("查询付款结果")}
        </button>
      )}
    </div>
  );
}

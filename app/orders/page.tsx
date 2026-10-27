import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { sessionPaymentMode } from "@/lib/payments/mode";
import { formatMoney } from "@/lib/orders/money";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { HISTORY_FILTERS, readOrderHistory } from "@/lib/orders/history";
import { orderStatusLabel } from "@/lib/orders/status";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 按状态筛选并分页显示本人历史订单，包括下单时的商品、金额和时间。
 * 支付宝返回地址带有合法 order 参数时跳到该订单详情，由详情页检查归属。
 * 未登录时跳回首页，订单为空时显示空列表提示。
 */
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; status?: string; page?: string }>;
}) {
  const { t, locale } = await getTranslations();
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const query = await searchParams;
  const returnedOrder = query.order;

  // 浏览器返回参数只用于页面跳转，不作为已付款的判断依据。
  if (returnedOrder && /^[a-zA-Z0-9_-]{1,128}$/.test(returnedOrder)) {
    redirect(`/orders/${returnedOrder}`);
  }

  const history = await readOrderHistory(getDb(), session.user.id, query.status, query.page);

  const mode = sessionPaymentMode(session);
  const modeLabels: Record<string, string> = {
    mock: t("模拟"),
    sandbox: t("沙箱"),
    live: t("真实"),
  };

  return (
    <PageShell mode={mode === "mock" ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <h1 className={styles.heading}>{t("历史订单")}</h1>
      <nav className={styles.filters} aria-label={t("订单状态")}>
        {HISTORY_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={`/orders?status=${filter.value}`}
            aria-current={history.status === filter.value ? "page" : undefined}
          >
            {t(filter.label)}
          </Link>
        ))}
      </nav>
      <p className={styles.muted}>{t("共 {count} 笔订单", { count: history.total })}</p>
      {history.orders.length === 0 && <p className={styles.empty}>{t("暂无符合条件的订单。")}</p>}
      <ul className={styles.orders}>
        {history.orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`}>
              <span>
                {t(order.productName)} · ¥{formatMoney(order.amountFen)}
                <small>
                  {order.provider === "wechat" ? t("微信") : t("支付宝")} ·{" "}
                  {modeLabels[order.mode] ?? t("未知环境")} ·{" "}
                  {order.createdAt.toLocaleString(locale, { timeZone: "Asia/Shanghai" })}
                </small>
              </span>
              <span>{t(orderStatusLabel[order.status])}</span>
            </Link>
          </li>
        ))}
      </ul>
      {history.pages > 1 && (
        <nav className={styles.pagination} aria-label={t("订单分页")}>
          {history.page > 1 && (
            <Link href={`/orders?status=${history.status}&page=${history.page - 1}`}>
              {t("上一页")}
            </Link>
          )}
          <span>{t("第 {page} / {pages} 页", { page: history.page, pages: history.pages })}</span>
          {history.page < history.pages && (
            <Link href={`/orders?status=${history.status}&page=${history.page + 1}`}>
              {t("下一页")}
            </Link>
          )}
        </nav>
      )}
    </PageShell>
  );
}

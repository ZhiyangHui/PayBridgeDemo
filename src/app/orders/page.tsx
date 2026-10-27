import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { paymentMode } from "@/server/payments/mode";
import { formatMoney } from "@/server/orders/money";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { orderStatusLabel } from "@/server/orders/status";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示当前用户最近的 50 笔订单，按创建时间倒序排列。
 * 支付宝返回地址带有合法 order 参数时跳到该订单详情，由详情页检查归属。
 * 未登录时跳回首页，订单为空时显示空列表提示。
 */
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const returnedOrder = (await searchParams).order;

  // 浏览器返回参数只用于页面跳转，不作为已付款的判断依据。
  if (returnedOrder && /^[a-zA-Z0-9_-]{1,128}$/.test(returnedOrder)) {
    redirect(`/orders/${returnedOrder}`);
  }

  const orders = await getDb().order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const mode = paymentMode(session.provider);

  return (
    <PageShell mode={mode === "mock" ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <h1 className={styles.heading}>我的订单</h1>
      {orders.length === 0 && <p className={styles.muted}>还没有订单，去商店看看吧。</p>}
      <ul className={styles.orders}>
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`}>
              <span>
                测试商品 · ¥{formatMoney(order.amountFen)}
                <small>
                  {order.provider === "wechat" ? "微信" : "支付宝"} ·{" "}
                  {order.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                </small>
              </span>
              <span>{orderStatusLabel[order.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

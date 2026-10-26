import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { formatMoney } from "@/server/orders/money";
import { orderStatusLabel } from "@/server/orders/status";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import { OrderPoller } from "@/components/OrderPoller";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/** 订单详情兼作模拟收银台，付款结果只读取数据库。 */
export default async function OrderDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const order = await getDb().order.findFirst({
    where: { id: (await params).id, userId: session.user.id },
  });

  if (!order) {
    notFound();
  }

  const mock = getEnv().PAYMENT_MODE === "mock" && order.mode === "mock";
  const wallet = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;
  const pending = mock && order.status === "pending";
  const canPay = pending && order.provider === session.provider;
  const qr =
    canPay && order.provider === "wechat"
      ? await QRCode.toDataURL(new URL(`/orders/${order.id}`, getEnv().APP_URL).toString(), {
          width: 180,
          margin: 1,
        })
      : null;

  return (
    <PageShell mode={order.mode === "mock" ? "MOCK MODE" : getEnv().PAYMENT_MODE.toUpperCase()}>
      <AccountNav />
      <span className={styles.status}>{orderStatusLabel[order.status]}</span>
      <h1 className={styles.heading}>测试商品</h1>
      <p className={styles.price}>¥{formatMoney(order.amountFen)}</p>
      <p className={styles.muted}>{order.provider === "wechat" ? "微信支付" : "支付宝支付"}</p>
      <FormMessage code={(await searchParams).error} />
      {wallet && <p className={styles.muted}>模拟余额 ¥{formatMoney(wallet.balanceFen)}</p>}
      {pending && !canPay && (
        <p className={styles.muted}>该订单与登录渠道不一致，请取消后重新下单。</p>
      )}
      {pending && (
        <>
          {qr && (
            <Image
              className={styles.qr}
              src={qr}
              alt="模拟收银台二维码"
              width={180}
              height={180}
              unoptimized
            />
          )}
          <form
            action={`/api/mock/pay/${order.id}`}
            method="post"
            className={styles.row}
            style={{ marginTop: "1.5rem" }}
          >
            {canPay && (
              <button className={styles.button} name="action" value="pay">
                确认支付 ¥{formatMoney(order.amountFen)}
              </button>
            )}
            <button className={`${styles.button} ${styles.secondary}`} name="action" value="cancel">
              取消订单
            </button>
          </form>
          <OrderPoller id={order.id} />
        </>
      )}
      <Link className={styles.back} href="/dashboard">
        返回商店
      </Link>
    </PageShell>
  );
}

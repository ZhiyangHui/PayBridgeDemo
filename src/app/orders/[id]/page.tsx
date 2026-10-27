import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { paymentMode } from "@/server/payments/mode";
import { getEnv } from "@/server/config/env";
import { formatMoney } from "@/server/orders/money";
import { orderStatusLabel } from "@/server/orders/status";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import { OrderPoller } from "@/components/OrderPoller";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示当前用户的订单金额、支付渠道和数据库中的付款状态。
 * 模拟待付款订单显示确认付款与取消按钮；微信模拟订单额外显示本站收银台二维码。
 * 微信真实订单显示平台付款码；支付宝沙箱订单提供继续付款入口，两者都轮询服务端状态。
 * 未登录时跳回首页，订单不存在或不属于当前用户时显示 404。
 */
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

  // 查询条件同时包含订单 ID 和当前用户 ID，不向其他用户展示该订单。
  const order = await getDb().order.findFirst({
    where: { id: (await params).id, userId: session.user.id },
  });

  if (!order) {
    notFound();
  }

  const mock = paymentMode(order.provider) === "mock" && order.mode === "mock";
  const sandbox = order.mode === "sandbox" && paymentMode(order.provider) === "sandbox";
  const wallet = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;
  const liveWechat =
    order.provider === "wechat" && order.mode === "live" && paymentMode("wechat") === "live";
  const liveQr =
    liveWechat && order.status === "pending" && order.paymentUrl
      ? await QRCode.toDataURL(order.paymentUrl, { width: 240, margin: 1 })
      : null;
  const pending = mock && order.status === "pending";
  // 确认付款按钮只开放给与订单支付渠道一致的登录会话。
  const canPay = pending && order.provider === session.provider;
  // 这里的模拟二维码指向本站订单页，不是微信平台生成的真实付款码。
  const qr =
    canPay && order.provider === "wechat"
      ? await QRCode.toDataURL(new URL(`/orders/${order.id}`, getEnv().APP_URL).toString(), {
          width: 180,
          margin: 1,
        })
      : null;

  return (
    <PageShell mode={order.mode === "mock" ? "MOCK MODE" : order.mode.toUpperCase()}>
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
            <>
              <Image
                className={styles.qr}
                src={qr}
                alt="模拟收银台二维码"
                width={180}
                height={180}
                unoptimized
              />
              <p className={styles.muted}>模拟付款码，可直接点击下方按钮付款。</p>
            </>
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
      {liveWechat && order.status === "pending" && (
        <>
          {liveQr && (
            <Image
              className={styles.qr}
              src={liveQr}
              alt="微信付款二维码"
              width={240}
              height={240}
              unoptimized
            />
          )}
          <p className={styles.muted}>使用微信扫码付款，确认后页面会自动更新。</p>
          {!liveQr && session.provider === "wechat" && (
            <form action="/api/pay/wechat/create" method="post">
              <input type="hidden" name="orderId" value={order.id} />
              <button className={styles.button}>重新获取付款码</button>
            </form>
          )}
          <OrderPoller id={order.id} />
        </>
      )}
      {sandbox && order.status === "pending" && (
        <>
          <p className={styles.muted}>
            等待支付宝确认。若已付款，页面会自动更新；关闭收银台不会立即取消订单。
          </p>
          {session.provider === "alipay" && (
            <form action="/api/pay/alipay/create" method="post">
              <input type="hidden" name="orderId" value={order.id} />
              <button className={styles.button}>继续支付宝沙箱付款</button>
            </form>
          )}
          <OrderPoller id={order.id} />
        </>
      )}
      <Link className={styles.back} href="/dashboard">
        返回商店
      </Link>
    </PageShell>
  );
}

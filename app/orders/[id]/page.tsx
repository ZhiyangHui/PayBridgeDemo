import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { paymentMode, sessionPaymentMode } from "@/lib/payments/mode";
import { getEnv } from "@/lib/config/env";
import { formatMoney } from "@/lib/orders/money";
import { orderStatusLabel } from "@/lib/orders/status";
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

  const matchesSession = order.mode === sessionPaymentMode(session, order.provider);
  const mock = matchesSession && order.mode === "mock";
  const sandbox =
    matchesSession && order.mode === "sandbox" && paymentMode(order.provider) === "sandbox";
  const wallet = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;
  const liveWechat =
    matchesSession &&
    order.provider === "wechat" &&
    order.mode === "live" &&
    paymentMode("wechat") === "live";
  const liveQr =
    liveWechat && order.status === "pending" && order.paymentUrl
      ? await QRCode.toDataURL(order.paymentUrl, { width: 240, margin: 1 })
      : null;
  const pending = mock && order.status === "pending";
  // 这里的模拟二维码指向本站订单页，不是微信平台生成的真实付款码。
  const qr =
    pending && order.provider === "wechat"
      ? await QRCode.toDataURL(new URL(`/orders/${order.id}`, getEnv().APP_URL).toString(), {
          width: 180,
          margin: 1,
        })
      : null;

  return (
    <PageShell mode={order.mode === "mock" ? "MOCK MODE" : order.mode.toUpperCase()}>
      <AccountNav />
      <span className={styles.status}>{orderStatusLabel[order.status]}</span>
      <h1 className={styles.heading}>{order.productName}</h1>
      <p className={styles.price}>¥{formatMoney(order.amountFen)}</p>
      <p className={styles.muted}>{order.provider === "wechat" ? "微信支付" : "支付宝支付"}</p>
      <dl className={styles.orderInfo}>
        <dt>订单号</dt>
        <dd>{order.outTradeNo}</dd>
        <dt>下单时间</dt>
        <dd>{order.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd>
        {order.paidAt && (
          <>
            <dt>付款时间</dt>
            <dd>{order.paidAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd>
          </>
        )}
      </dl>
      <FormMessage code={(await searchParams).error} />
      {!matchesSession && order.status === "pending" && (
        <p className={styles.muted}>该订单的支付环境与当前会话不同，请确认配置后重新登录。</p>
      )}
      {wallet && <p className={styles.muted}>模拟余额 ¥{formatMoney(wallet.balanceFen)}</p>}
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
            <button className={styles.button} name="action" value="pay">
              确认支付 ¥{formatMoney(order.amountFen)}
            </button>
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
          {!liveQr && (
            <form action="/api/pay/wechat/create" method="post">
              <input type="hidden" name="paymentMode" value={order.mode} />
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
          <form action="/api/pay/alipay/create" method="post">
            <input type="hidden" name="paymentMode" value={order.mode} />
            <input type="hidden" name="orderId" value={order.id} />
            <button className={styles.button}>继续支付宝沙箱付款</button>
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

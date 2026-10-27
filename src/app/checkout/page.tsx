import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { paymentMode } from "@/server/payments/mode";
import { TEST_ITEM } from "@/server/orders/service";
import { formatMoney } from "@/server/orders/money";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示测试商品金额和当前登录渠道的付款按钮。
 * 未登录时返回首页，尚未开放的正式支付模式返回商店。
 * 每次渲染生成提交键，用于服务端识别重复下单；错误码通过表单提示组件展示。
 */
export default async function Checkout({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const mode = paymentMode(session.provider);

  if (mode === "live" && session.provider !== "wechat") {
    redirect("/dashboard");
  }

  // 生成本次结算页的提交键，重复提交同一表单时复用同一订单。
  const checkoutKey = randomUUID();

  return (
    <PageShell mode={mode === "mock" ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <h1 className={styles.heading}>确认购买</h1>
      <p>{TEST_ITEM.name}</p>
      <p className={styles.price}>¥{formatMoney(TEST_ITEM.amountFen)}</p>
      {mode === "sandbox" && (
        <p className={styles.muted}>使用支付宝沙箱买家账号付款，不扣本站模拟余额。</p>
      )}
      {mode === "live" && <p className={styles.muted}>使用微信扫码付款，将支付真实的 0.01 元。</p>}
      <FormMessage code={(await searchParams).error} />
      <div className={styles.row}>
        <form action={`/api/pay/${session.provider}/create`} method="post">
          <input type="hidden" name="checkoutKey" value={checkoutKey} />
          <button className={styles.button}>
            {session.provider === "wechat" ? "微信支付" : "支付宝支付"}
          </button>
        </form>
      </div>
    </PageShell>
  );
}

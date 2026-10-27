import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { sessionPaymentMode } from "@/lib/payments/mode";
import { findProduct } from "@/lib/orders/catalog";
import { formatMoney } from "@/lib/orders/money";
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
  searchParams: Promise<{ error?: string; product?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const mode = sessionPaymentMode(session);

  if (mode === "live" && session.provider !== "wechat") {
    redirect("/dashboard");
  }

  const query = await searchParams;
  let product;

  try {
    product = findProduct(query.product);
  } catch {
    notFound();
  }

  // 生成本次结算页的提交键，重复提交同一表单时复用同一订单。
  const checkoutKey = randomUUID();

  return (
    <PageShell mode={mode === "mock" ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <h1 className={styles.heading}>确认购买</h1>
      <p>{product.name}</p>
      <p className={styles.price}>¥{formatMoney(product.amountFen)}</p>
      {mode === "sandbox" && (
        <p className={styles.muted}>使用支付宝沙箱买家账号付款，不扣本站模拟余额。</p>
      )}
      {mode === "live" && (
        <p className={styles.muted}>
          使用微信扫码付款，将支付真实的 ¥{formatMoney(product.amountFen)}。
        </p>
      )}
      <FormMessage code={query.error} />
      <div className={styles.row}>
        <form action={`/api/pay/${session.provider}/create`} method="post">
          <input type="hidden" name="paymentMode" value={mode} />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="checkoutKey" value={checkoutKey} />
          <button className={styles.button}>
            {session.provider === "wechat" ? "微信支付" : "支付宝支付"}
          </button>
        </form>
      </div>
    </PageShell>
  );
}

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
 * 显示测试商品和两种付款方式，付款渠道与登录渠道无关。
 * 未登录时返回首页，尚未实现的支付方式显示为不可用。
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
      <FormMessage code={query.error} />
      <div className={styles.row}>
        {(["wechat", "alipay"] as const).map((provider) => {
          const selectedMode = sessionPaymentMode(session, provider);
          const unavailable = provider === "alipay" && selectedMode === "live";
          const descriptions = {
            mock: "模拟付款，仅扣本站余额",
            sandbox: "沙箱付款，跳转支付宝官方收银台",
            live: "真实付款，会扣真实账户余额",
          };

          return (
            <form action={`/api/pay/${provider}/create`} method="post" key={provider}>
              <input type="hidden" name="paymentMode" value={selectedMode} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="checkoutKey" value={checkoutKey} />
              <button className={styles.button} disabled={unavailable}>
                {provider === "wechat" ? "微信支付" : "支付宝支付"}
              </button>
              <p className={styles.muted}>
                {unavailable ? "支付宝正式付款尚未接入" : descriptions[selectedMode]}
              </p>
            </form>
          );
        })}
      </div>
    </PageShell>
  );
}

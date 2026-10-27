import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { paymentMode } from "@/server/payments/mode";
import { getDb } from "@/server/db/client";
import { formatMoney } from "@/server/orders/money";
import { TEST_ITEM } from "@/server/orders/service";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示当前用户昵称、测试商品和购买入口。
 * 模拟支付显示可调整的本站余额，支付宝沙箱显示使用沙箱余额的说明。
 * 未登录时跳回首页，模拟账号不存在时提示重新注册。
 */
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const mode = paymentMode(session.provider);
  const mock = mode === "mock";
  // 仅模拟付款读取本地钱包，沙箱付款不显示或使用该余额。
  const account = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <PageShell mode={mock ? "MOCK MODE" : "ALIPAY SANDBOX"}>
      <AccountNav />
      <h1 className={styles.heading}>{session.user.nickname}</h1>
      <FormMessage code={(await searchParams).error} />
      {account && (
        <section className={styles.balance}>
          <p className={styles.muted}>模拟余额</p>
          <p className={styles.price}>¥{formatMoney(account.balanceFen)}</p>
          <details>
            <summary>调整余额</summary>
            <form action="/api/mock/wallet" method="post" className={styles.form}>
              <label>
                余额（元）
                <input
                  name="balance"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  defaultValue={formatMoney(account.balanceFen)}
                  required
                />
              </label>
              <button className={styles.button}>保存</button>
            </form>
          </details>
        </section>
      )}
      {mock && !account && <p className={styles.muted}>请退出后注册模拟账号，开始购买。</p>}
      {mode === "sandbox" && <p className={styles.muted}>付款使用支付宝沙箱余额。</p>}
      <section className={styles.card}>
        <h2>{TEST_ITEM.name}</h2>
        <p className={styles.price}>¥{formatMoney(TEST_ITEM.amountFen)}</p>
        {account || mode === "sandbox" ? (
          <Link className={styles.button} href="/checkout">
            购买
          </Link>
        ) : (
          <p className={styles.muted}>暂不可购买</p>
        )}
      </section>
    </PageShell>
  );
}

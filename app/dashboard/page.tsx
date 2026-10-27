import Link from "next/link";
import { UserAvatar } from "@/components/UserAvatar";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { sessionPaymentMode } from "@/lib/payments/mode";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/orders/money";
import { TEST_PRODUCTS } from "@/lib/orders/catalog";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示当前用户昵称、测试商品和购买入口。
 * 显示用户头像和登录渠道；模拟支付显示本站余额，支付宝沙箱显示沙箱余额说明。
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

  const mode = sessionPaymentMode(session);
  const mock = mode === "mock";
  // 仅模拟付款读取本地钱包，沙箱付款不显示或使用该余额。
  const account = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <PageShell mode={mock ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <div className={styles.profile}>
        <UserAvatar src={session.user.avatar} provider={session.provider} />
        <div>
          <h1 className={styles.heading}>{session.user.nickname}</h1>
          <p className={styles.muted}>
            {session.provider === "wechat" ? "微信登录" : "支付宝登录"}
          </p>
        </div>
      </div>
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
      <div className={styles.products}>
        {TEST_PRODUCTS.map((product) => (
          <section className={styles.card} key={product.id}>
            <h2>{product.name}</h2>
            <p className={styles.price}>¥{formatMoney(product.amountFen)}</p>
            {account || mode === "sandbox" || (mode === "live" && session.provider === "wechat") ? (
              <Link className={styles.button} href={`/checkout?product=${product.id}`}>
                购买
              </Link>
            ) : (
              <p className={styles.muted}>暂不可购买</p>
            )}
          </section>
        ))}
      </div>
    </PageShell>
  );
}

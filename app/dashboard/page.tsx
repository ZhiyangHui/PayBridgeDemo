import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { UserAvatar } from "@/components/UserAvatar";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { sessionPaymentMode, hasMockPayment } from "@/lib/payments/mode";
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
  const { t } = await getTranslations();
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const mode = sessionPaymentMode(session);
  const mock = hasMockPayment(session);
  // 只要有模拟付款方式就显示本站余额，平台付款不会使用该余额。
  const account = mock
    ? await getDb().mockAccount.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <PageShell mode={mode === "mock" ? "MOCK MODE" : mode.toUpperCase()}>
      <AccountNav />
      <div className={styles.profile}>
        <UserAvatar src={session.user.avatar} provider={session.provider} />
        <div>
          <h1 className={styles.heading}>{session.user.nickname}</h1>
          <p className={styles.muted}>
            {session.provider === "wechat" ? t("微信登录") : t("支付宝登录")}
          </p>
        </div>
      </div>
      <FormMessage code={(await searchParams).error} />
      {account && (
        <section className={styles.balance}>
          <p className={styles.muted}>{t("模拟余额")}</p>
          <p className={styles.price}>¥{formatMoney(account.balanceFen)}</p>
          <details>
            <summary>{t("调整余额")}</summary>
            <form action="/api/mock/wallet" method="post" className={styles.form}>
              <label>
                {t("余额（元）")}
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
              <button className={styles.button}>{t("保存")}</button>
            </form>
          </details>
        </section>
      )}
      {mock && !account && <p className={styles.muted}>{t("请退出后注册模拟账号，开始购买。")}</p>}
      {mode === "sandbox" && (
        <p className={styles.muted}>
          {t("微信与支付宝可在结算时选择，付款模式以按钮旁说明为准。")}
        </p>
      )}
      <div className={styles.products}>
        {TEST_PRODUCTS.map((product) => (
          <section className={styles.card} key={product.id}>
            <h2>{t(product.name)}</h2>
            <p className={styles.price}>¥{formatMoney(product.amountFen)}</p>
            {account || mode === "sandbox" || mode === "live" ? (
              <Link className={styles.button} href={`/checkout?product=${product.id}`}>
                {t("购买")}
              </Link>
            ) : (
              <p className={styles.muted}>{t("暂不可购买")}</p>
            )}
          </section>
        ))}
      </div>
    </PageShell>
  );
}

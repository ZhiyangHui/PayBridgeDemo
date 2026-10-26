import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";
import { TEST_ITEM } from "@/server/orders/service";
import { formatMoney } from "@/server/orders/money";
import { PageShell } from "@/components/PageShell";
import { AccountNav } from "@/components/AccountNav";
import { FormMessage } from "@/components/FormMessage";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/** 使用登录渠道提交一次下单请求，商品金额由服务端确定。 */
export default async function Checkout({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  if (getEnv().PAYMENT_MODE !== "mock") {
    redirect("/dashboard");
  }

  const checkoutKey = randomUUID();

  return (
    <PageShell mode="MOCK MODE">
      <AccountNav />
      <h1 className={styles.heading}>确认购买</h1>
      <p>{TEST_ITEM.name}</p>
      <p className={styles.price}>¥{formatMoney(TEST_ITEM.amountFen)}</p>
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

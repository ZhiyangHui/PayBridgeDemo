import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** 登录后显示当前身份和测试商品，未登录时返回首页。 */
export default async function Dashboard() {
  const session = await currentSession();

  if (!session) {
    redirect("/");
  }

  const env = getEnv();

  return (
    <PageShell mode={env.PAYMENT_MODE === "mock" ? "MOCK MODE" : env.PAYMENT_MODE.toUpperCase()}>
      <div className={styles.profile}>
        {session.user.avatar ? (
          <Image
            unoptimized
            src={session.user.avatar}
            width={64}
            height={64}
            alt="用户头像"
            className={styles.avatar}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.fallback} aria-label="默认头像">
            {session.user.nickname.slice(0, 1)}
          </span>
        )}
        <div>
          <h1>{session.user.nickname}</h1>
          <p>登录渠道：{session.provider === "wechat" ? "微信" : "支付宝"}</p>
        </div>
      </div>

      <section className={styles.product}>
        <h2>测试商品</h2>
        <p>人民币 0.01 元</p>
        <button disabled>购买测试商品 · 待接入</button>
      </section>

      <form action="/api/auth/logout" method="post">
        <button className={styles.logout}>退出登录</button>
      </form>
    </PageShell>
  );
}

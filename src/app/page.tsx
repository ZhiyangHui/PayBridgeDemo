import Link from "next/link";
import { getEnv } from "@/server/config/env";
import { currentSession } from "@/server/auth/session";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** 展示登录入口和当前会话，明确标注模拟渠道。 */
export default async function Home() {
  const env = getEnv();
  const session = await currentSession();

  return (
    <PageShell mode={env.PAYMENT_MODE === "mock" ? "MOCK MODE" : env.PAYMENT_MODE.toUpperCase()}>
      <h1 className={styles.title}>登录 payBridge</h1>
      <p className={styles.description}>选择登录方式</p>

      <div className={styles.actions}>
        <a className={styles.loginButton} href="/api/auth/wechat/start">
          微信登录{env.WECHAT_MODE === "mock" ? "（模拟）" : ""}
        </a>
        <a className={styles.loginButton} href="/api/auth/alipay/start">
          支付宝登录{env.PAYMENT_MODE === "mock" ? "（模拟）" : ""}
        </a>
        {env.PAYMENT_MODE === "mock" && (
          <a className={styles.loginButton} href="/api/auth/alipay/sandbox/start">
            支付宝登录（沙箱）
          </a>
        )}
      </div>

      {session && (
        <p className={styles.description}>
          已登录为 {session.user.nickname}，<Link href="/dashboard">进入商店</Link>。
        </p>
      )}
    </PageShell>
  );
}

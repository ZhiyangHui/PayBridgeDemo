import Link from "next/link";
import { getEnv } from "@/lib/config/env";
import { currentSession } from "@/lib/session";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** 显示微信和支付宝入口，点击后选择测试环境。 */
export default async function Home() {
  const env = getEnv();
  const session = await currentSession();

  return (
    <PageShell mode={env.PAYMENT_MODE === "mock" ? "MOCK MODE" : env.PAYMENT_MODE.toUpperCase()}>
      <h1 className={styles.title}>登录 payBridge</h1>
      <p className={styles.description}>先选登录平台，再选模拟或沙箱。</p>
      <div className={styles.actions}>
        {(["wechat", "alipay"] as const).map((provider) => (
          <Link className={styles.loginButton} href={`/login/${provider}`} key={provider}>
            {provider === "wechat" ? "微信登录" : "支付宝登录"}
          </Link>
        ))}
      </div>
      {session && (
        <p className={styles.description}>
          已登录为 {session.user.nickname}，<Link href="/dashboard">进入商店</Link>。
        </p>
      )}
    </PageShell>
  );
}

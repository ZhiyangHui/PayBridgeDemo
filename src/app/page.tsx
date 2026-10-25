import { getEnv } from "@/server/config/env";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default function Home() {
  const env = getEnv();

  return (
    <main className={styles.page}>
      <span className={styles.mode}>
        {env.PAYMENT_MODE === "mock" ? "MOCK MODE" : env.PAYMENT_MODE.toUpperCase()}
      </span>
      <h1 className={styles.title}>payBridge Demo</h1>
      <p className={styles.subtitle}>微信与支付宝登录、支付演示。</p>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>项目骨架已就绪</h2>
        <p className={styles.description}>
          框架、数据库和开发工具已配置。接下来接入登录与支付，目前还不能授权或付款。
        </p>
        <div className={styles.actions}>
          {["微信登录 · 待接入", "支付宝登录 · 待接入"].map((label) => (
            <button key={label} disabled className={styles.loginButton}>{label}</button>
          ))}
        </div>
      </section>
    </main>
  );
}

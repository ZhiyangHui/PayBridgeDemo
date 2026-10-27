import Link from "next/link";
import { getEnv } from "@/lib/config/env";
import { currentSession } from "@/lib/session";
import { isMockLogin } from "@/lib/auth/routes";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示支付宝模拟、支付宝沙箱、微信模拟和微信待接入四个入口。
 * 支付宝沙箱先走本站模拟登录，再使用沙箱收银台；微信入口保留待接入占位。
 * 用户已有有效会话时，显示昵称及进入商店的链接。
 */
export default async function Home() {
  const env = getEnv();
  const session = await currentSession();

  return (
    <PageShell mode={env.PAYMENT_MODE === "mock" ? "MOCK MODE" : env.PAYMENT_MODE.toUpperCase()}>
      <h1 className={styles.title}>登录 payBridge</h1>
      <p className={styles.description}>选择登录方式</p>

      <div className={styles.actions}>
        {isMockLogin("alipay") ? (
          <a className={styles.loginButton} href="/api/auth/alipay/start">
            支付宝模拟
          </a>
        ) : (
          <button className={styles.loginButton} disabled title="当前配置未启用模拟登录">
            支付宝模拟
          </button>
        )}
        {/* 沙箱入口先登录本站账号，购买时才进入支付宝官方收银台。 */}
        {env.PAYMENT_MODE === "sandbox" && isMockLogin("alipay") ? (
          <a className={styles.loginButton} href="/api/auth/alipay/sandbox/start">
            支付宝沙箱
            <span className={styles.buttonHint}>本站账号登录后付款</span>
          </a>
        ) : (
          <button
            className={styles.loginButton}
            disabled
            title="需启用支付宝沙箱支付和本站模拟登录"
          >
            支付宝沙箱
            <span className={styles.buttonHint}>沙箱付款尚未启用</span>
          </button>
        )}
        {isMockLogin("wechat") ? (
          <a className={styles.loginButton} href="/api/auth/wechat/start">
            微信模拟
          </a>
        ) : (
          <button className={styles.loginButton} disabled title="当前配置未启用模拟登录">
            微信模拟
          </button>
        )}
        {/* 微信没有独立沙箱；按当前需求保留待接入入口，不发起模拟或真实授权。 */}
        <button
          className={styles.loginButton}
          disabled
          title="微信无独立沙箱，待公司提供凭据后接入真实环境"
        >
          微信沙箱
          <span className={styles.buttonHint}>账号信息尚未接入</span>
        </button>
      </div>

      {session && (
        <p className={styles.description}>
          已登录为 {session.user.nickname}，<Link href="/dashboard">进入商店</Link>。
        </p>
      )}
    </PageShell>
  );
}

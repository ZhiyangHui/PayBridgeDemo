import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnv } from "@/lib/config/env";
import { PageShell } from "@/components/PageShell";
import styles from "@/app/page.module.css";

export const dynamic = "force-dynamic";

/** 显示平台的模拟和沙箱入口，未提供的环境保留说明并禁用。 */
export default async function LoginOptions({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  if (provider !== "wechat" && provider !== "alipay") {
    notFound();
  }

  const sandboxAvailable = provider === "alipay" && getEnv().PAYMENT_MODE === "sandbox";
  const sandboxHint =
    provider === "wechat" ? "暂无可用官方沙箱，尚未接入" : "请先在本地配置支付宝沙箱";

  return (
    <PageShell>
      <h1 className={styles.title}>{provider === "wechat" ? "微信" : "支付宝"}登录</h1>
      <div className={styles.actions}>
        <a className={styles.loginButton} href={`/api/auth/${provider}/start?mode=mock`}>
          模拟
          <span className={styles.buttonHint}>本站账号，付款只扣模拟余额</span>
        </a>
        {sandboxAvailable ? (
          <a className={styles.loginButton} href="/api/auth/alipay/sandbox/start">
            沙箱
            <span className={styles.buttonHint}>本站账号登录，支付宝沙箱付款</span>
          </a>
        ) : (
          <button className={styles.loginButton} disabled>
            沙箱
            <span className={styles.buttonHint}>{sandboxHint}</span>
          </button>
        )}
      </div>
      <p className={styles.description}>
        <Link href="/">返回选择平台</Link>
      </p>
    </PageShell>
  );
}

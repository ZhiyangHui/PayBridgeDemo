import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnv } from "@/lib/config/env";
import { PageShell } from "@/components/PageShell";
import styles from "@/app/page.module.css";

export const dynamic = "force-dynamic";

/** 显示平台的模拟和沙箱入口，未提供的环境保留说明并禁用。 */
export default async function LoginOptions({ params }: { params: Promise<{ provider: string }> }) {
  const { t } = await getTranslations();
  const { provider } = await params;

  if (provider !== "wechat" && provider !== "alipay") {
    notFound();
  }

  const sandboxAvailable = provider === "alipay" && getEnv().PAYMENT_MODE === "sandbox";
  const sandboxHint =
    provider === "wechat" ? t("本次不做真实接入，保留模拟体验") : t("请先在本地配置支付宝沙箱");

  return (
    <PageShell>
      <h1 className={styles.title}>{provider === "wechat" ? t("微信登录") : t("支付宝登录")}</h1>
      <div className={styles.actions}>
        <a className={styles.loginButton} href={`/api/auth/${provider}/start?mode=mock`}>
          {t("模拟")}
          <span className={styles.buttonHint}>{t("本站账号，付款只扣模拟余额")}</span>
        </a>
        {sandboxAvailable ? (
          <a className={styles.loginButton} href="/api/auth/alipay/sandbox/start">
            {t("沙箱")}
            <span className={styles.buttonHint}>{t("本站账号登录，支付宝沙箱付款")}</span>
          </a>
        ) : (
          <button className={styles.loginButton} disabled>
            {provider === "wechat" ? t("真实接入") : t("沙箱")}
            <span className={styles.buttonHint}>{sandboxHint}</span>
          </button>
        )}
      </div>
      <p className={styles.description}>
        <Link href="/">{t("返回选择平台")}</Link>
      </p>
    </PageShell>
  );
}

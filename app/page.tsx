import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { currentSession } from "@/lib/session";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** 显示微信和支付宝入口，点击后选择测试环境。 */
export default async function Home() {
  const { t } = await getTranslations();
  const session = await currentSession();

  return (
    <PageShell>
      <h1 className={styles.title}>{t("登录 payBridge")}</h1>
      <p className={styles.description}>{t("先选登录平台，再选模拟或沙箱。")}</p>
      <div className={styles.actions}>
        {(["wechat", "alipay"] as const).map((provider) => (
          <Link className={styles.loginButton} href={`/login/${provider}`} key={provider}>
            {provider === "wechat" ? t("微信登录") : t("支付宝登录")}
          </Link>
        ))}
      </div>
      {session && (
        <p className={styles.description}>
          {t("已登录为 {name}", { name: session.user.nickname })} ·{" "}
          <Link href="/dashboard">{t("进入商店")}</Link>
        </p>
      )}
    </PageShell>
  );
}

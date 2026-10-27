"use client";

import { useTranslations } from "@/components/LanguageProvider";
import Link from "next/link";
import styles from "./shop.module.css";

/**
 * 显示商店、订单列表和退出登录入口。
 * 退出操作提交 POST 表单，由服务端撤销当前会话。
 */
export function AccountNav() {
  const { t } = useTranslations();

  return (
    <nav className={styles.nav} aria-label={t("账号导航")}>
      <Link href="/dashboard">{t("商店")}</Link>
      <Link href="/orders">{t("历史订单")}</Link>
      <form action="/api/auth/logout" method="post">
        <button>{t("退出")}</button>
      </form>
    </nav>
  );
}

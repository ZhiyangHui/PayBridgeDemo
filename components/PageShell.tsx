"use client";

import { LanguageToggle, useTranslations } from "@/components/LanguageProvider";
import Link from "next/link";
import styles from "./PageShell.module.css";

/** 页面布局接收的内容和运行模式标识。 */
type PageShellProps = {
  /** 页面主体内容。 */
  children: React.ReactNode;
  /** 可选的运行模式文案，未提供时不显示标识。 */
  mode?: string;
};

/**
 * 渲染页面公共外框，包括首页链接、可选模式标识和内容卡片。
 * @param children 页面主体内容。
 * @param mode 要显示的运行模式文字，未提供时隐藏标识。
 */
export function PageShell({ children, mode }: PageShellProps) {
  const { t } = useTranslations();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">payBridge Demo</Link>
        <div className={styles.controls}>
          {mode && <span className={styles.badge}>{t(mode)}</span>}
          <LanguageToggle />
        </div>
      </header>

      <section className={styles.card}>{children}</section>
    </main>
  );
}

import Link from "next/link";
import styles from "./PageShell.module.css";

/** 页面布局接收的内容和运行模式标识。 */
type PageShellProps = {
  children: React.ReactNode;
  mode?: string;
};

/** 登录相关页面共用的布局，只接收安全的展示内容。 */
export function PageShell({ children, mode }: PageShellProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/">payBridge Demo</Link>
        {mode && <span className={styles.badge}>{mode}</span>}
      </header>

      <section className={styles.card}>{children}</section>
    </main>
  );
}

import Link from "next/link";
import styles from "./shop.module.css";

/**
 * 显示商店、订单列表和退出登录入口。
 * 退出操作提交 POST 表单，由服务端撤销当前会话。
 */
export function AccountNav() {
  return (
    <nav className={styles.nav} aria-label="账号导航">
      <Link href="/dashboard">商店</Link>
      <Link href="/orders">历史订单</Link>
      <form action="/api/auth/logout" method="post">
        <button>退出</button>
      </form>
    </nav>
  );
}

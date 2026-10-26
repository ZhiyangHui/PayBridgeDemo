import Link from "next/link";
import styles from "./shop.module.css";

/** 已登录页面的简短导航。 */
export function AccountNav() {
  return (
    <nav className={styles.nav} aria-label="账号导航">
      <Link href="/dashboard">商店</Link>
      <Link href="/orders">我的订单</Link>
      <form action="/api/auth/logout" method="post">
        <button>退出</button>
      </form>
    </nav>
  );
}

import { errorDefinitions } from "@/server/errors/app-error";
import styles from "./shop.module.css";

/** 表单只展示固定错误提示，不回显服务端内部信息。 */
export function FormMessage({ code }: { code?: string }) {
  if (!code) {
    return null;
  }

  const message = Object.hasOwn(errorDefinitions, code)
    ? errorDefinitions[code as keyof typeof errorDefinitions][1]
    : "操作失败，请重试";

  return (
    <p role="alert" className={styles.error}>
      {message}
    </p>
  );
}

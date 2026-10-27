import { errorDefinitions } from "@/server/errors/app-error";
import styles from "./shop.module.css";

/**
 * 将表单错误码转换成可供用户阅读的提示。
 * 未提供错误码时不渲染，未知错误码显示通用失败文案。
 */
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

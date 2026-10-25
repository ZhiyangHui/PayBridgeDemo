import path from "node:path";
import { AppError } from "../errors/app-error";
/** 将 SQLite 相对路径统一解析到项目根目录。 */
export function databaseUrl(value: string) {
  if (!value.startsWith("file:") || !value.slice(5).trim()) throw new AppError("CONFIG_ERROR", "DATABASE_URL 必须指定 SQLite 文件");
  return `file:${path.resolve(/* turbopackIgnore: true */ process.cwd(), value.slice(5))}`;
}

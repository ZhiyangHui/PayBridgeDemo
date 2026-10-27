import path from "node:path";
import { AppError } from "../errors/app-error";

/**
 * 把 file: 开头的 SQLite 路径转换为绝对文件地址。
 * 相对路径以当前进程的工作目录为基准。
 * @throws AppError 缺少 file: 前缀或文件路径为空时抛出 CONFIG_ERROR。
 */
export function databaseUrl(value: string) {
  if (!value.startsWith("file:") || !value.slice(5).trim()) {
    throw new AppError("CONFIG_ERROR", "DATABASE_URL 必须指定 SQLite 文件");
  }

  return `file:${path.resolve(/* turbopackIgnore: true */ process.cwd(), value.slice(5))}`;
}

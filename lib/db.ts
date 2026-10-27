import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getEnv } from "@/lib/config/env";
import { databaseUrl } from "@/lib/db/url";
import { AppError } from "@/lib/errors/app-error";

/** 开发热更新时复用连接，避免重复创建客户端。 */
const globalDb = globalThis as unknown as { prisma?: PrismaClient };

/**
 * 获取可复用的 Prisma 数据库客户端，第一次调用时创建 SQLite 连接适配器。
 * @returns 缓存在当前进程中的客户端实例。
 * @throws AppError 配置错误由 getEnv 抛出，客户端初始化失败为 DATABASE_ERROR。
 */
export function getDb(): PrismaClient {
  if (globalDb.prisma) {
    return globalDb.prisma;
  }

  const url = databaseUrl(getEnv().DATABASE_URL);

  try {
    globalDb.prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

    return globalDb.prisma;
  } catch (cause) {
    throw new AppError("DATABASE_ERROR", "数据库客户端初始化失败", { cause });
  }
}

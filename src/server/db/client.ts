import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getEnv } from "@/server/config/env";
import { databaseUrl } from "@/server/db/url";
import { AppError } from "@/server/errors/app-error";

/** 开发热更新时复用连接，避免重复创建客户端。 */
const globalDb = globalThis as unknown as { prisma?: PrismaClient };

/** 延迟创建数据库连接，使初始化错误也能由接口边界处理。 */
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

import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getEnv } from "@/server/config/env";
import { databaseUrl } from "@/server/db/url";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl(getEnv().DATABASE_URL) }) });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;

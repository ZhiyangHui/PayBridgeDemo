import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors/app-error";
import { errorResponse } from "@/server/errors/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 检查数据库连通性，失败时返回安全提示和追踪 ID。 */
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok" });
  } catch (cause) {
    return errorResponse(cause instanceof AppError ? cause : new AppError("DATABASE_ERROR", undefined, { cause }));
  }
}

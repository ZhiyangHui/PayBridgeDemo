import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors/app-error";
import { errorResponse } from "@/server/errors/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 执行一次数据库 SELECT 1 检查服务连通性。
 * 成功返回状态 JSON，失败返回固定错误提示和追踪编号，不展示数据库详情。
 */
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;

    return Response.json({ status: "ok", database: "ok" });
  } catch (cause) {
    return errorResponse(
      cause instanceof AppError ? cause : new AppError("DATABASE_ERROR", undefined, { cause }),
    );
  }
}

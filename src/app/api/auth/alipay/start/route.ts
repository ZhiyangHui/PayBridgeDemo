import type { NextRequest } from "next/server";
import { startLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/** 处理 alipay 的 start 请求。 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay");
}

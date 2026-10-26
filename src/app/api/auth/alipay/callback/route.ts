import type { NextRequest } from "next/server";
import { finishLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/** 处理 alipay 的 callback 请求。 */
export function GET(request: NextRequest) {
  return finishLogin(request, "alipay");
}

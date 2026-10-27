import type { NextRequest } from "next/server";
import { logout } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 接收退出登录请求，撤销会话、清除 Cookie 后跳回首页。
 */
export function POST(request: NextRequest) {
  return logout(request);
}

import type { NextRequest } from "next/server";
import { finishLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/**
 * 处理微信登录回调，验证授权状态并在成功后创建本站会话。
 */
export function GET(request: NextRequest) {
  return finishLogin(request, "wechat");
}

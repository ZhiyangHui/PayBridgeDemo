import type { NextRequest } from "next/server";
import { startLogin } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 发起微信登录，创建授权状态并跳转当前配置对应的登录页面。
 */
export function GET(request: NextRequest) {
  return startLogin(request, "wechat");
}

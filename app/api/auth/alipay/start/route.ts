import type { NextRequest } from "next/server";
import { startLogin } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 发起支付宝登录，按配置跳转模拟账号页面或官方授权页面。
 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay");
}

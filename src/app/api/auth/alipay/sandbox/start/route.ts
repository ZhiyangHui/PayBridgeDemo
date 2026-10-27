import type { NextRequest } from "next/server";
import { startLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/**
 * 单独发起支付宝官方沙箱登录，创建 sandbox 授权状态并跳转授权页。
 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay", true);
}

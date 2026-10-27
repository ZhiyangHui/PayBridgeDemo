import type { NextRequest } from "next/server";
import { startLogin } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 发起本站账号登录，允许结算时选择支付宝沙箱付款。
 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay", true);
}

import type { NextRequest } from "next/server";
import { startLogin } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 发起本站账号登录，将本次会话的付款方式固定为支付宝沙箱。
 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay", true);
}

import type { NextRequest } from "next/server";
import { startLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/** 独立发起支付宝沙箱授权，不切换全站模拟模式。 */
export function GET(request: NextRequest) {
  return startLogin(request, "alipay", true);
}

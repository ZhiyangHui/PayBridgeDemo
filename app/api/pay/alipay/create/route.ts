import type { NextRequest } from "next/server";
import { createPayment } from "@/lib/payments/routes";

export const runtime = "nodejs";

/**
 * 接收支付宝下单或继续付款表单，跳转模拟订单页或官方沙箱收银台。
 */
export function POST(request: NextRequest) {
  return createPayment(request, "alipay");
}

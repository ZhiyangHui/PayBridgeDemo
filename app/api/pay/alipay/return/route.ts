import type { NextRequest } from "next/server";
import { paymentReturn } from "@/lib/payments/return";

/** 接收支付宝页面回跳，转到本站订单详情；支付结果由通知或查单确认。 */
export function GET(request: NextRequest) {
  return paymentReturn(request);
}

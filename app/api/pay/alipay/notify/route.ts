import type { NextRequest } from "next/server";
import { receiveNotification } from "@/lib/payments/routes";

export const runtime = "nodejs";

/**
 * 接收支付宝异步支付通知，验签并更新订单后返回 success，失败返回 failure。
 */
export function POST(request: NextRequest) {
  return receiveNotification(request, "alipay");
}

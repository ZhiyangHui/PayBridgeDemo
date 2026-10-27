import type { NextRequest } from "next/server";
import { createPayment } from "@/server/payments/routes";

export const runtime = "nodejs";

/**
 * 接收微信下单表单，检查登录渠道并创建模拟订单，跳转订单收银台。
 */
export function POST(request: NextRequest) {
  return createPayment(request, "wechat");
}

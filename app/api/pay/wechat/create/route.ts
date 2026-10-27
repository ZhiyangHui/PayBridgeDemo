import type { NextRequest } from "next/server";
import { createPayment } from "@/lib/payments/routes";

export const runtime = "nodejs";

/**
 * 接收微信下单表单，检查登录渠道，按配置创建模拟或 Native 订单并跳转付款页。
 */
export function POST(request: NextRequest) {
  return createPayment(request, "wechat");
}

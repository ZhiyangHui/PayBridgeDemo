import type { NextRequest } from "next/server";
import { simulatePayment } from "@/lib/payments/routes";

/**
 * 读取路径中的订单 ID，处理当前用户模拟订单的付款、取消或退款操作。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return simulatePayment(request, (await context.params).id);
}

import type { NextRequest } from "next/server";
import { simulatePayment } from "@/server/payments/routes";

/**
 * 读取路径中的订单 ID，处理当前用户模拟订单的付款或取消操作。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return simulatePayment(request, (await context.params).id);
}

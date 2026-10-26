import type { NextRequest } from "next/server";
import { simulatePayment } from "@/server/payments/routes";

/** 确认或取消本人模拟订单。 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return simulatePayment(request, (await context.params).id);
}

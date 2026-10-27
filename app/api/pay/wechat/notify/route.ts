import type { NextRequest } from "next/server";
import { receiveNotification } from "@/lib/payments/routes";

export const runtime = "nodejs";

/**
 * 接收微信支付通知，交给当前环境的验签和记账处理器并返回处理结果。
 */
export function POST(request: NextRequest) {
  return receiveNotification(request, "wechat");
}

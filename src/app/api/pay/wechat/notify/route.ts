import type { NextRequest } from "next/server";
import { receiveNotification } from "@/server/payments/routes";

export const runtime = "nodejs";

/** 处理 wechat 的 notify 请求。 */
export function POST(request: NextRequest) {
  return receiveNotification(request, "wechat");
}

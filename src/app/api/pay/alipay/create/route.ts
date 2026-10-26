import type { NextRequest } from "next/server";
import { createPayment } from "@/server/payments/routes";

export const runtime = "nodejs";

/** 处理 alipay 的 create 请求。 */
export function POST(request: NextRequest) {
  return createPayment(request, "alipay");
}

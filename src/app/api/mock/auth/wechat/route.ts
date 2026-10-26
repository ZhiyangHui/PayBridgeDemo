import type { NextRequest } from "next/server";
import { confirmMockLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/** 确认或取消 wechat 模拟授权。 */
export function POST(request: NextRequest) {
  return confirmMockLogin(request, "wechat");
}

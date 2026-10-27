import type { NextRequest } from "next/server";
import { confirmMockLogin } from "@/lib/auth/routes";

export const runtime = "nodejs";

/**
 * 接收微信模拟账号注册或登录表单，验证后跳转微信登录回调。
 */
export function POST(request: NextRequest) {
  return confirmMockLogin(request, "wechat");
}

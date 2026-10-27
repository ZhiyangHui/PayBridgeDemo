import type { NextRequest } from "next/server";
import { confirmMockLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/**
 * 接收支付宝模拟账号注册或登录表单，验证后跳转支付宝登录回调。
 */
export function POST(request: NextRequest) {
  return confirmMockLogin(request, "alipay");
}

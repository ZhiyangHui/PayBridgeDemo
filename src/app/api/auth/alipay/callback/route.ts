import type { NextRequest } from "next/server";
import { finishLogin } from "@/server/auth/routes";

export const runtime = "nodejs";

/**
 * 处理支付宝登录回调，验证授权状态、获取用户资料并创建本站会话。
 */
export function GET(request: NextRequest) {
  return finishLogin(request, "alipay");
}

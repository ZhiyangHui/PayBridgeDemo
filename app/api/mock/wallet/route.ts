import type { NextRequest } from "next/server";
import { updateBalance } from "@/lib/payments/routes";

/**
 * 接收余额表单，更新当前用户的模拟钱包并跳回商店。
 */
export function POST(request: NextRequest) {
  return updateBalance(request);
}

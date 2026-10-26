import type { NextRequest } from "next/server";
import { updateBalance } from "@/server/payments/routes";

/** 修改本人模拟余额。 */
export function POST(request: NextRequest) {
  return updateBalance(request);
}

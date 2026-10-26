import type { NextRequest } from "next/server";
import { logout } from "@/server/auth/routes";

export const runtime = "nodejs";

/** 通过同源 POST 撤销当前会话。 */
export function POST(request: NextRequest) {
  return logout(request);
}

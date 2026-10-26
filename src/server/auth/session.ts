import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "../config/env";
import { getDb } from "../db/client";
import { readSession } from "./store";

export const SESSION_COOKIE = "paybridge_session";

/** Cookie 对脚本不可见，HTTPS 环境启用 Secure。 */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: new URL(getEnv().APP_URL).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** 在服务端读取当前用户，不向页面暴露令牌或数据库会话字段。 */
export async function currentSession() {
  return readSession(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

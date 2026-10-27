import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "./config/env";
import { getDb } from "./db";
import { readSession } from "./auth/store";

export const SESSION_COOKIE = "paybridge_session";

/**
 * 生成登录和授权 Cookie 的属性。
 * @param maxAge Cookie 有效期，单位为秒；传 0 用于清除 Cookie。
 * @returns httpOnly、SameSite=Lax、全站路径和有效期；配置站点为 HTTPS 时启用 Secure。
 */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: new URL(getEnv().APP_URL).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * 读取当前请求的会话 Cookie，并查询对应的有效用户会话。
 * @returns 当前登录渠道和用户资料，未登录或会话过期时返回 null。
 */
export async function currentSession() {
  return readSession(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

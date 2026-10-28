import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "../config/env";

/** 将支付平台返回的浏览器带回本站订单页，不读取或修改支付状态。 */
export function paymentReturn(request: NextRequest) {
  const order = request.nextUrl.searchParams.get("order");
  const path = order && /^[a-zA-Z0-9_-]{1,128}$/.test(order) ? `/orders/${order}` : "/orders";
  // 使用配置中的网站地址，沿用用户下单时的登录域名；订单页仍检查登录和归属。
  const response = NextResponse.redirect(new URL(path, getEnv().APP_URL), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");

  return response;
}

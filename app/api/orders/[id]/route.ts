import type { NextRequest } from "next/server";
import { currentSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { paymentMode, sessionPaymentMode } from "@/lib/payments/mode";
import { alipayPaymentConfig, refreshAlipayOrder } from "@/lib/alipay";
import { refreshWechatOrder, wechatPaymentConfig } from "@/lib/wechat";
import { ownOrder } from "@/lib/orders/service";
import { AppError } from "@/lib/errors/app-error";
import { errorResponse } from "@/lib/errors/response";

/**
 * 查询当前用户订单的最新状态，微信真实订单和支付宝沙箱订单按频率限制主动查单。
 * 返回禁止缓存的状态 JSON；未登录、无权读取或查单失败时返回统一错误响应。
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await currentSession();

    if (!session) {
      throw new AppError("UNAUTHENTICATED");
    }

    // 先限定用户归属，只有本人订单才能读取或触发平台查单。
    let order = await ownOrder(getDb(), session.user.id, (await context.params).id);

    // 模拟会话查看旧沙箱订单时只读本站记录，不触发远程查单。
    if (order.mode !== sessionPaymentMode(session, order.provider)) {
      return Response.json({ status: order.status }, { headers: { "Cache-Control": "no-store" } });
    }

    // 仅在当前环境仍为支付宝沙箱时查询对应订单，避免切换配置后串环境。
    if (
      order.mode === "sandbox" &&
      order.provider === "alipay" &&
      paymentMode("alipay") === "sandbox"
    ) {
      order = await refreshAlipayOrder(getDb(), order, alipayPaymentConfig());
    }

    // 微信正式订单采用已验签的查单结果补回漏通知。
    if (order.mode === "live" && order.provider === "wechat" && paymentMode("wechat") === "live") {
      order = await refreshWechatOrder(getDb(), order, wechatPaymentConfig());
    }

    return Response.json({ status: order.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

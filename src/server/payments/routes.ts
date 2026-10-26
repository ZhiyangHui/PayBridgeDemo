import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "../auth/session";
import { requireSameOrigin } from "../auth/routes";
import { getEnv } from "../config/env";
import { getDb } from "../db/client";
import { AppError } from "../errors/app-error";
import { errorResponse } from "../errors/response";
import { createMockOrder, ownOrder, cancelMockOrder, setMockBalance } from "../orders/service";
import { getMockPaymentKeys } from "./mock-keys";
import { mockPaymentNotification } from "./mock-provider";
import { handleMockNotification } from "./handler";
import type { LoginProvider } from "../auth/types";

/** 模拟资金操作只允许模拟模式下已登录的同源请求。 */
async function requireMockSession(request: NextRequest) {
  requireSameOrigin(request);

  if (getEnv().PAYMENT_MODE !== "mock") {
    throw new AppError("MOCK_ONLY");
  }

  const session = await currentSession();

  if (!session) {
    throw new AppError("UNAUTHENTICATED");
  }

  return session;
}

/** 表单错误回到当前页面，只带安全的错误码。 */
function formFailure(cause: unknown, path: string) {
  errorResponse(cause);
  const url = new URL(path, getEnv().APP_URL);
  url.searchParams.set("error", cause instanceof AppError ? cause.code : "INTERNAL_ERROR");

  return NextResponse.redirect(url, 303);
}

/** 先创建待支付订单，再跳转到模拟收银台。 */
export async function createPayment(request: NextRequest, provider: LoginProvider) {
  try {
    const session = await requireMockSession(request);

    if (provider !== session.provider) {
      throw new AppError("PAYMENT_CHANNEL_MISMATCH");
    }

    const form = await request.formData();
    const order = await createMockOrder(
      getDb(),
      session.user.id,
      provider,
      String(form.get("checkoutKey") ?? ""),
    );

    return NextResponse.redirect(new URL(`/orders/${order.id}`, getEnv().APP_URL), 303);
  } catch (cause) {
    return formFailure(cause, "/checkout");
  }
}

/** 用户确认模拟付款后产生签名通知；页面跳转本身不能改变付款状态。 */
export async function simulatePayment(request: NextRequest, id: string) {
  try {
    const session = await requireMockSession(request);
    const order = await ownOrder(getDb(), session.user.id, id);

    if (order.mode !== "mock") {
      throw new AppError("MOCK_ONLY");
    }

    const action = (await request.formData()).get("action");

    if (action === "cancel") {
      await cancelMockOrder(getDb(), session.user.id, id);
    } else if (action === "pay") {
      if (order.provider !== session.provider) {
        throw new AppError("PAYMENT_CHANNEL_MISMATCH");
      }

      const keys = getMockPaymentKeys();
      const notification = mockPaymentNotification(order, keys);
      const incoming = new Request(new URL(`/api/pay/${order.provider}/notify`, getEnv().APP_URL), {
        method: "POST",
        ...notification,
      });
      await handleMockNotification(getDb(), incoming, order.provider, keys);
    } else {
      throw new AppError("INVALID_INPUT");
    }

    return NextResponse.redirect(new URL(`/orders/${id}`, getEnv().APP_URL), 303);
  } catch (cause) {
    return formFailure(cause, `/orders/${id}`);
  }
}

/** 保存当前用户的模拟余额。 */
export async function updateBalance(request: NextRequest) {
  try {
    const session = await requireMockSession(request);
    const form = await request.formData();
    await setMockBalance(getDb(), session.user.id, String(form.get("balance") ?? ""));

    return NextResponse.redirect(new URL("/dashboard", getEnv().APP_URL), 303);
  } catch (cause) {
    return formFailure(cause, "/dashboard");
  }
}

/** 接收平台通知；当前仅开放模拟订单，真实支付接入后使用对应平台配置。 */
export async function receiveNotification(request: NextRequest, provider: LoginProvider) {
  try {
    return await handleMockNotification(getDb(), request, provider, getMockPaymentKeys());
  } catch (cause) {
    errorResponse(cause);

    if (provider === "alipay") {
      return new Response("failure", { status: 400 });
    }

    return Response.json({ code: "FAIL", message: "通知处理失败" }, { status: 400 });
  }
}

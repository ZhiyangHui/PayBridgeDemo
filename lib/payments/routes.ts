import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "../session";
import { requireSameOrigin } from "../auth/routes";
import { getEnv } from "../config/env";
import { getDb } from "../db";
import { AppError } from "../errors/app-error";
import { errorResponse } from "../errors/response";
import { createMockOrder, ownOrder, cancelMockOrder, setMockBalance } from "../orders/service";
import { getMockPaymentKeys } from "./mock-keys";
import { mockPaymentNotification } from "./mock-provider";
import { handleMockNotification } from "./handler";
import { paymentMode, sessionPaymentMode } from "./mode";
import { findProduct } from "../orders/catalog";
import { createRemoteOrder } from "../orders/remote";
import { createWechatPayment, handleWechatNotification, wechatPaymentConfig } from "../wechat";
import { createSandboxOrder } from "../orders/sandbox";
import { alipayPaymentConfig, alipayCheckoutUrl, handleAlipayNotification } from "../alipay";
import type { LoginProvider } from "../auth/types";

/**
 * 检查请求来源、登录状态和当前登录渠道的支付模式。
 * @returns 当前登录会话，包含用户和登录渠道。
 * @throws AppError 非同源请求为 FORBIDDEN，未登录为 UNAUTHENTICATED，非模拟支付为 MOCK_ONLY。
 */
async function requireMockSession(request: NextRequest) {
  requireSameOrigin(request);

  const session = await currentSession();

  if (!session) {
    throw new AppError("UNAUTHENTICATED");
  }

  if (sessionPaymentMode(session) !== "mock") {
    throw new AppError("MOCK_ONLY");
  }

  return session;
}

/**
 * 记录表单处理错误，并将浏览器重定向到指定站内页面。
 * @param path 接收错误的页面路径，错误码写入 error 查询参数。
 * @returns HTTP 303 重定向，未知异常统一显示 INTERNAL_ERROR。
 */
function formFailure(cause: unknown, path: string) {
  errorResponse(cause);
  const url = new URL(path, getEnv().APP_URL);
  url.searchParams.set("error", cause instanceof AppError ? cause.code : "INTERNAL_ERROR");

  return NextResponse.redirect(url, 303);
}

/**
 * 处理下单表单，创建或读取订单后跳转对应收银台。
 * 先检查请求来源、用户会话和支付渠道，再区分微信 Native、支付宝沙箱与本地模拟支付。
 * @returns 成功时跳转收银台或订单页；失败时跳回结算页并附带错误码。
 */
export async function createPayment(request: NextRequest, provider: LoginProvider) {
  let failurePath = "/checkout";

  try {
    requireSameOrigin(request);
    const session = await currentSession();

    if (!session) {
      throw new AppError("UNAUTHENTICATED");
    }

    // 付款渠道必须与当前登录渠道一致。
    if (provider !== session.provider) {
      throw new AppError("PAYMENT_CHANNEL_MISMATCH");
    }

    const form = await request.formData();
    const productId = findProduct(String(form.get("productId") ?? "test-item")).id;
    failurePath = `/checkout?product=${encodeURIComponent(productId)}`;
    const mode = sessionPaymentMode(session);

    if (form.get("paymentMode") !== mode) {
      throw new AppError("PAYMENT_MODE_MISMATCH");
    }

    const id = String(form.get("orderId") ?? "");
    const existingOrder = id ? await ownOrder(getDb(), session.user.id, id) : null;

    // 历史订单继续付款也必须匹配会话，不能借 orderId 切换支付环境。
    if (existingOrder && (existingOrder.mode !== mode || existingOrder.provider !== provider)) {
      throw new AppError("PAYMENT_MODE_MISMATCH");
    }

    // 支付宝沙箱下单使用真实沙箱配置，继续付款时先查询本人订单。
    if (mode === "sandbox" && provider === "alipay") {
      const config = alipayPaymentConfig();
      const order =
        existingOrder ??
        (await createSandboxOrder(
          getDb(),
          session.user.id,
          String(form.get("checkoutKey") ?? ""),
          config,
          productId,
        ));

      // 订单已经结束时只展示详情，不重新生成付款链接。
      if (order.status !== "pending") {
        return NextResponse.redirect(new URL(`/orders/${order.id}`, getEnv().APP_URL), 303);
      }

      return NextResponse.redirect(alipayCheckoutUrl(order, config), 303);
    }

    // 微信 Native 先保存订单，再调用平台下单，金额和收款身份都来自服务端。
    if (mode === "live" && provider === "wechat") {
      const config = wechatPaymentConfig();
      const order =
        existingOrder ??
        (await createRemoteOrder(
          getDb(),
          session.user.id,
          String(form.get("checkoutKey") ?? ""),
          {
            ...config,
            provider: "wechat",
            mode: "live",
          },
          productId,
        ));
      failurePath = `/orders/${order.id}`;
      await createWechatPayment(getDb(), order, config);

      return NextResponse.redirect(new URL(failurePath, getEnv().APP_URL), 303);
    }

    // 未实现的平台模式明确报错，不能悄悄切回模拟付款。
    if (mode !== "mock") {
      throw new AppError("PAYMENT_UNAVAILABLE");
    }

    const order =
      existingOrder ??
      (await createMockOrder(
        getDb(),
        session.user.id,
        provider,
        String(form.get("checkoutKey") ?? ""),
        productId,
      ));

    return NextResponse.redirect(new URL(`/orders/${order.id}`, getEnv().APP_URL), 303);
  } catch (cause) {
    return formFailure(cause, failurePath);
  }
}

/**
 * 处理当前用户模拟订单的付款或取消操作。
 * 付款时生成带签名的模拟通知，交给通知处理器验签并扣除模拟余额。
 * @returns 操作完成后跳回订单详情；失败时在详情页显示错误码。
 */
export async function simulatePayment(request: NextRequest, id: string) {
  try {
    const session = await requireMockSession(request);
    const order = await ownOrder(getDb(), session.user.id, id);

    if (order.mode !== "mock") {
      throw new AppError("MOCK_ONLY");
    }

    const action = (await request.formData()).get("action");

    // 取消订单直接更新模拟订单；确认付款则生成签名通知。
    if (action === "cancel") {
      await cancelMockOrder(getDb(), session.user.id, id);
    } else if (action === "pay") {
      if (order.provider !== session.provider) {
        throw new AppError("PAYMENT_CHANNEL_MISMATCH");
      }

      const keys = getMockPaymentKeys(order.provider, sessionPaymentMode(session));
      const notification = mockPaymentNotification(order, keys);
      // 构造通知请求并调用共用处理器，不能由按钮直接将订单改为已支付。
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

/**
 * 读取表单中的元金额，更新当前登录用户的模拟余额。
 * 检查同源、登录和模拟模式，失败时将错误码带回商店页。
 */
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

/**
 * 接收支付平台通知，按渠道和环境选择验签及订单处理器。
 * @returns 支付宝成功返回 success；微信真实成功返回 HTTP 204，模拟成功返回 SUCCESS JSON；失败返回平台可识别的 HTTP 400 响应。
 */
export async function receiveNotification(request: NextRequest, provider: LoginProvider) {
  try {
    // 测试通知与平台通知使用不同密钥；伪造标识也必须通过验签及订单模式校验。
    const mockNotice =
      provider === "alipay"
        ? new URLSearchParams(await request.clone().text()).get("app_id") === "paybridge_mock"
        : request.headers.get("Wechatpay-Serial") === "PAYBRIDGE_MOCK";

    if (mockNotice) {
      return await handleMockNotification(
        getDb(),
        request,
        provider,
        getMockPaymentKeys(provider, "mock"),
      );
    }

    // 通知入口按服务端配置选择真实沙箱公钥或本地测试密钥。
    const mode = paymentMode(provider);

    if (mode === "sandbox" && provider === "alipay") {
      return await handleAlipayNotification(getDb(), request, alipayPaymentConfig());
    }

    if (mode === "live" && provider === "wechat") {
      return await handleWechatNotification(getDb(), request, wechatPaymentConfig());
    }

    if (mode !== "mock") {
      throw new AppError("PAYMENT_UNAVAILABLE");
    }

    return await handleMockNotification(getDb(), request, provider, getMockPaymentKeys(provider));
  } catch (cause) {
    errorResponse(cause);

    if (provider === "alipay") {
      return new Response("failure", { status: 400 });
    }

    return Response.json({ code: "FAIL", message: "通知处理失败" }, { status: 400 });
  }
}

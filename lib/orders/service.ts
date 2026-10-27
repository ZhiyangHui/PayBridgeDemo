import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import type { LoginProvider } from "../auth/types";
import type { PaymentNotice } from "../payments/notification";
import { AppError } from "../errors/app-error";
import { parseMoney } from "./money";
import { findProduct } from "./catalog";

/**
 * 为当前模拟账号创建选定商品的待付款订单。
 * 检查账号渠道，并按 checkoutKey 复用重复提交的订单。
 * @throws AppError 参数错误为 INVALID_INPUT；非模拟账号为 MOCK_ONLY；渠道不符为 PAYMENT_CHANNEL_MISMATCH；订单归属不符为 CONFLICT。
 */
export async function createMockOrder(
  db: PrismaClient,
  userId: string,
  provider: LoginProvider,
  checkoutKey: string,
  productId = "test-item",
) {
  if (!/^[a-f0-9-]{36}$/.test(checkoutKey)) {
    throw new AppError("INVALID_INPUT");
  }

  const product = findProduct(productId);
  const account = await db.mockAccount.findUnique({ where: { userId } });

  if (!account) {
    throw new AppError("MOCK_ONLY");
  }

  if (account.provider !== provider) {
    throw new AppError("PAYMENT_CHANNEL_MISMATCH");
  }

  // 按目录读取金额，保存商品快照；客户端只传商品编号，不能指定金额。
  const order = await db.order.upsert({
    where: { checkoutKey },
    update: {},
    create: {
      userId,
      provider,
      checkoutKey,
      mode: "mock",
      outTradeNo: `PB${randomUUID().replaceAll("-", "")}`,
      productId: product.id,
      productName: product.name,
      amountFen: product.amountFen,
      currency: "CNY",
    },
  });

  if (
    order.userId !== userId ||
    order.provider !== provider ||
    order.mode !== "mock" ||
    order.productId !== product.id
  ) {
    throw new AppError("CONFLICT");
  }

  return order;
}

/**
 * 按订单 ID 和用户 ID 查询一笔属于该用户的订单。
 * @returns 完整订单记录。
 * @throws AppError 订单不存在或不属于该用户时抛出 NOT_FOUND。
 */
export async function ownOrder(db: PrismaClient, userId: string, id: string) {
  const order = await db.order.findFirst({ where: { id, userId } });

  if (!order) {
    throw new AppError("NOT_FOUND");
  }

  return order;
}

/**
 * 将指定用户的模拟余额设置为输入金额。
 * @param amount 以元为单位的金额字符串，最多两位小数。
 * @throws AppError 金额无效时抛出 INVALID_AMOUNT，用户没有模拟钱包时抛出 MOCK_ONLY。
 */
export async function setMockBalance(db: PrismaClient, userId: string, amount: string) {
  const balanceFen = parseMoney(amount);
  const result = await db.mockAccount.updateMany({ where: { userId }, data: { balanceFen } });

  if (result.count !== 1) {
    throw new AppError("MOCK_ONLY");
  }
}

/**
 * 将当前用户尚未付款的模拟订单设为已关闭，不扣余额。
 * @throws AppError 找不到本人订单时抛出 NOT_FOUND，订单不是待付款模拟订单时抛出 CONFLICT。
 */
export async function cancelMockOrder(db: PrismaClient, userId: string, id: string) {
  await ownOrder(db, userId, id);
  const result = await db.order.updateMany({
    where: { id, userId, mode: "mock", status: "pending" },
    data: { status: "closed" },
  });

  if (result.count !== 1) {
    throw new AppError("CONFLICT");
  }
}

/**
 * 根据已验签的通知完成模拟付款：核对订单、扣余额、保存付款结果。
 * 以上操作在同一事务中执行，任一步失败都会回滚；相同交易已处理时直接返回。
 * @throws AppError 通知与订单不符为 PAYMENT_INVALID，渠道不符为 PAYMENT_CHANNEL_MISMATCH，状态冲突为 CONFLICT，余额不足为 INSUFFICIENT_BALANCE。
 */
export async function settleMockPayment(db: PrismaClient, notice: PaymentNotice) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { outTradeNo: notice.outTradeNo } });

    // 先核对通知的订单号、渠道、金额和币种，并拒绝关闭通知。
    if (
      !order ||
      order.mode !== "mock" ||
      notice.status === "closed" ||
      order.provider !== notice.provider ||
      order.amountFen !== notice.amountFen ||
      order.currency !== notice.currency
    ) {
      throw new AppError("PAYMENT_INVALID");
    }

    // 相同交易已经记账时直接返回，不再次扣余额或写通知。
    if (order.status === "paid" && order.providerTradeNo === notice.tradeNo) {
      return;
    }

    const account = await tx.mockAccount.findUnique({ where: { userId: order.userId } });

    if (!account || account.provider !== notice.provider) {
      throw new AppError("PAYMENT_CHANNEL_MISMATCH");
    }

    // 尝试把待付款订单改为已支付；条件更新用于拦截重复或并发处理。
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: "paid", providerTradeNo: notice.tradeNo, paidAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new AppError("CONFLICT");
    }

    // 只从余额充足的钱包扣款；并发付款也必须满足数据库中的当前余额。
    const debit = await tx.mockAccount.updateMany({
      where: { userId: order.userId, balanceFen: { gte: order.amountFen } },
      data: { balanceFen: { decrement: order.amountFen } },
    });

    // 扣款失败则抛出异常，事务会撤销前面的订单状态更新。
    if (debit.count !== 1) {
      throw new AppError("INSUFFICIENT_BALANCE");
    }

    // 记录已处理的通知，通知唯一键冲突也会导致整个事务回滚。
    await tx.paymentNotification.create({
      data: {
        provider: notice.provider,
        dedupeKey: notice.dedupeKey,
        orderId: order.id,
        result: "paid",
      },
    });
  });
}

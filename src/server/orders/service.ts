import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import type { LoginProvider } from "../auth/types";
import type { PaymentNotice } from "../payments/notification";
import { AppError } from "../errors/app-error";
import { parseMoney } from "./money";

export const TEST_ITEM = { name: "测试商品", amountFen: 1 } as const;

/** 创建服务端定价的待付款订单；同一提交键只产生一个订单。 */
export async function createMockOrder(
  db: PrismaClient,
  userId: string,
  provider: LoginProvider,
  checkoutKey: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(checkoutKey)) {
    throw new AppError("INVALID_INPUT");
  }

  const account = await db.mockAccount.findUnique({ where: { userId } });

  if (!account) {
    throw new AppError("MOCK_ONLY");
  }

  if (account.provider !== provider) {
    throw new AppError("PAYMENT_CHANNEL_MISMATCH");
  }

  const order = await db.order.upsert({
    where: { checkoutKey },
    update: {},
    create: {
      userId,
      provider,
      checkoutKey,
      mode: "mock",
      outTradeNo: `PB${randomUUID().replaceAll("-", "")}`,
      amountFen: TEST_ITEM.amountFen,
      currency: "CNY",
    },
  });

  if (order.userId !== userId || order.provider !== provider) {
    throw new AppError("CONFLICT");
  }

  return order;
}

/** 查询本人订单，其他人的订单与不存在的订单返回相同错误。 */
export async function ownOrder(db: PrismaClient, userId: string, id: string) {
  const order = await db.order.findFirst({ where: { id, userId } });

  if (!order) {
    throw new AppError("NOT_FOUND");
  }

  return order;
}

/** 自定义的模拟余额只修改当前用户的钱包。 */
export async function setMockBalance(db: PrismaClient, userId: string, amount: string) {
  const balanceFen = parseMoney(amount);
  const result = await db.mockAccount.updateMany({ where: { userId }, data: { balanceFen } });

  if (result.count !== 1) {
    throw new AppError("MOCK_ONLY");
  }
}

/** 取消尚未支付的订单，已支付订单不能被改回关闭。 */
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

/** 在一个事务内核对通知、扣余额和记账，失败全部回滚，重复通知不重复扣款。 */
export async function settleMockPayment(db: PrismaClient, notice: PaymentNotice) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { outTradeNo: notice.outTradeNo } });

    if (
      !order ||
      order.mode !== "mock" ||
      order.provider !== notice.provider ||
      order.amountFen !== notice.amountFen ||
      order.currency !== notice.currency
    ) {
      throw new AppError("PAYMENT_INVALID");
    }

    if (order.status === "paid" && order.providerTradeNo === notice.tradeNo) {
      return;
    }

    const account = await tx.mockAccount.findUnique({ where: { userId: order.userId } });

    if (!account || account.provider !== notice.provider) {
      throw new AppError("PAYMENT_CHANNEL_MISMATCH");
    }

    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: "paid", providerTradeNo: notice.tradeNo, paidAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new AppError("CONFLICT");
    }

    const debit = await tx.mockAccount.updateMany({
      where: { userId: order.userId, balanceFen: { gte: order.amountFen } },
      data: { balanceFen: { decrement: order.amountFen } },
    });

    if (debit.count !== 1) {
      throw new AppError("INSUFFICIENT_BALANCE");
    }

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

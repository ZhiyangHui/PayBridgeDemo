import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";

/**
 * 将本人已付款的模拟订单全额退回本站钱包，并记录退款时间。
 * 重复退款直接返回；余额和订单在同一事务中更新，任一步失败都会回滚。
 * @throws NOT_FOUND：不是本人订单；MOCK_ONLY：非模拟订单或钱包缺失；REFUND_NOT_ALLOWED：尚未付款或已关闭。
 */
export async function refundMockOrder(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id, userId } });

    if (!order) {
      throw new AppError("NOT_FOUND");
    }

    if (order.mode !== "mock") {
      throw new AppError("MOCK_ONLY");
    }

    if (order.status === "refunded") {
      return;
    }

    if (order.status !== "paid") {
      throw new AppError("REFUND_NOT_ALLOWED");
    }

    // 只允许一次 paid → refunded，退款金额读取订单，不接受浏览器传入。
    const changed = await tx.order.updateMany({
      where: { id, userId, mode: "mock", status: "paid" },
      data: { status: "refunded", refundedAt: new Date() },
    });

    if (changed.count !== 1) {
      throw new AppError("CONFLICT");
    }

    // 退回原本站用户的钱包；钱包不存在时撤销退款状态，不留下半笔记录。
    const credit = await tx.mockAccount.updateMany({
      where: { userId },
      data: { balanceFen: { increment: order.amountFen } },
    });

    if (credit.count !== 1) {
      throw new AppError("MOCK_ONLY");
    }
  });
}

import type { OrderStatus, PrismaClient } from "../../generated/prisma/client";

/** 历史订单可选的状态筛选，全部包含待付款和已结束订单。 */
export const HISTORY_FILTERS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待付款" },
  { value: "paid", label: "已付款" },
  { value: "refunded", label: "已退款" },
  { value: "closed", label: "已取消" },
  { value: "failed", label: "支付失败" },
] as const;

/**
 * 分页读取当前用户的历史订单，并返回数量和有效筛选条件。
 * 每页 20 笔；非法筛选回到全部，越界页码收敛到有效范围。
 * 用户范围始终来自服务端会话，不能从网址指定其他用户。
 */
export async function readOrderHistory(
  db: PrismaClient,
  userId: string,
  filter = "all",
  requestedPage = "1",
) {
  const status = HISTORY_FILTERS.find((item) => item.value === filter)?.value ?? "all";
  const parsedPage = /^\d{1,6}$/.test(requestedPage) ? Number(requestedPage) : 1;
  const where = { userId, ...(status === "all" ? {} : { status: status as OrderStatus }) };
  const pageSize = 20;

  // 总数和列表使用相同条件，避免分页统计混入其他用户的订单。
  return db.$transaction(async (tx) => {
    const total = await tx.order.count({ where });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, parsedPage));
    const orders = await tx.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { orders, total, page, pages, status };
  });
}

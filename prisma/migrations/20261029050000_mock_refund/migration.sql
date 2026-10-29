-- 保留已有订单，新增模拟退款时间。SQLite 的状态枚举由 Prisma 校验。
ALTER TABLE "Order" ADD COLUMN "refundedAt" DATETIME;

# 订单 / Orders

改商品看 `catalog.ts`，改模拟订单和余额看 `service.ts`，改平台订单看 `remote.ts`、`sandbox.ts`，查历史订单看 `history.ts`。`polling.ts` 负责订单页自动查单和暂停重试。金额统一按分计算。

Edit `catalog.ts` for products, `service.ts` for mock orders and balances, `remote.ts` and `sandbox.ts` for provider orders, and `history.ts` for order lists. `polling.ts` handles automatic status checks and retry limits. Amounts are stored in integer fen.

模拟全额退款见 `lib/orders/refund.ts`，只退本站余额，同一订单只退一次。

Mock full refunds use `lib/orders/refund.ts`, returning local funds only once per order.

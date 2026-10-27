# 支付 / Payments

`routes.ts` 接付款请求，`alipay.ts`、`wechat.ts` 对接平台，`notification.ts` 验签。模拟付款在 `mock-*` 和 `handler.ts`，付款模式由 `mode.ts` 检查。

`routes.ts` handles payment requests, `alipay.ts` and `wechat.ts` connect to providers, and `notification.ts` verifies signatures. `mock-*` and `handler.ts` handle mock payments; `mode.ts` checks the payment mode.

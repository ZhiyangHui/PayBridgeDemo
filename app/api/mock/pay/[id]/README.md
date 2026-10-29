# 模拟付款 / Mock payment

POST 确认或取消本人的模拟订单。确认时生成签名通知，验签后扣余额，不调用支付平台。

POST pays or cancels the user’s mock order. Payment generates a signed notification and deducts the balance after verification, without calling a provider.

模拟全额退款见 `lib/orders/refund.ts`，只退本站余额，同一订单只退一次。

Mock full refunds use `lib/orders/refund.ts`, returning local funds only once per order.

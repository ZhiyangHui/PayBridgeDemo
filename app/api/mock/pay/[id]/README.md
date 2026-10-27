# 模拟付款 / Mock payment

POST 确认或取消本人的模拟订单。确认时生成签名通知，验签后扣余额，不调用支付平台。

POST pays or cancels the user’s mock order. Payment generates a signed notification and deducts the balance after verification, without calling a provider.

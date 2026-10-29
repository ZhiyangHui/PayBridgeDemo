# 演示顺序 / Demo walkthrough

视频控制在 3–5 分钟。微信部分已取消，不必演示真实微信接入；支付宝登录使用本站模拟账号，要说清楚。

Keep the video to 3–5 minutes. Live WeChat is outside scope. Clearly state that Alipay uses local mock sign-in.

1. **启动（30 秒）**：展示示例配置下的启动命令和首页，不展示 `.env.local`。说明模拟模式不需要平台密钥。
2. **模拟流程（60 秒）**：注册本站测试账号，设余额，购买并确认付款；展示余额扣减和历史订单。再创建一单取消，余额不变。余额设为 0 后尝试购买，展示余额不足提示。
3. **沙箱付款（60–90 秒）**：提前启动沙箱服务，进入“支付宝 → 沙箱”，登录本站账号，购买 0.01 元商品，用沙箱买家付款，返回订单查看已支付。说明这次扣的是沙箱资金，不是本站模拟余额。
4. **代码（30–60 秒）**：打开 `lib/payments/alipay.ts`、`lib/payments/notification.ts` 和 `lib/orders/remote.ts`，说明验签、核对金额与收款方、重复通知不重复记账。订单详情会查单补回漏通知。
5. **结尾（15 秒）**：说明支付宝官方登录尚未完成，微信按沟通取消；展示测试结果和仓库地址。

1. Start the app with the example configuration; keep real secrets off-screen.
2. Demonstrate local registration, a mock purchase, balance changes, history, cancellation and insufficient funds.
3. Buy the CNY 0.01 item through Alipay sandbox and show the confirmed order. Distinguish sandbox funds from the local mock balance.
4. Explain signature checks, amount/merchant validation, idempotency and query recovery in the files above.
5. State the remaining login limitation and agreed WeChat scope, then show checks and the repository.

付款后返回失败时，重新打开本站并进入历史订单详情查询，别重复付款。视频不要展示私钥、令牌或包含授权码的完整地址。

If the return link fails after payment, open the app and check the order detail instead of paying again. Keep keys, tokens and authorization-code URLs out of the video.

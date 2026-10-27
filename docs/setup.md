# 支付接入 / Payment setup

## 支付宝沙箱 / Alipay sandbox

先在支付宝开放平台的沙箱控制台准备 App ID、应用私钥、支付宝公钥和商户 PID，填入 `.env.local` 对应字段。收银台付款使用沙箱买家账号。

Get the App ID, application private key, Alipay public key, and merchant PID from the Alipay sandbox console. Put them in the matching `.env.local` fields. Use a sandbox buyer account at checkout.

运行隧道，让支付宝能通知本地后端：

Run a tunnel so Alipay can reach the local backend:

```bash
cloudflared tunnel --url http://localhost:3000
```

把得到的 HTTPS 地址填入下面配置，保持隧道运行，再启动项目：

Use the tunnel’s HTTPS address below, keep the tunnel running, then start the app:

```dotenv
PAYMENT_MODE=sandbox
ALIPAY_LOGIN_MODE=mock
WECHAT_MODE=mock
APP_URL=https://your-tunnel-host
ALIPAY_APP_ID=your-sandbox-app-id
ALIPAY_SELLER_ID=your-sandbox-merchant-pid
ALIPAY_PRIVATE_KEY=your-application-private-key
ALIPAY_PUBLIC_KEY=your-alipay-public-key
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
ALIPAY_NOTIFY_URL=${APP_URL}/api/pay/alipay/notify
ALIPAY_RETURN_URL=${APP_URL}/orders
```

打开公网地址 → 选“支付宝沙箱” → 登录本站账号 → 买商品 → 用沙箱版支付宝付款 → 查看订单。地址变了就改配置并重启。

Open the public URL → choose Alipay sandbox → sign in locally → buy an item → pay with the sandbox Alipay app → check the order. Update configuration and restart if the tunnel URL changes.

网站先创建订单，收到通知后验签并更新状态；漏通知时查单补回。浏览器跳回来不算付款凭证。

The site creates an order first, verifies the payment notification, then updates its status. Status queries recover missed notifications. A browser redirect does not prove payment.

## 微信 / WeChat

目前用模拟模式。网站应用 OAuth 和 API v3 Native 代码已有，但缺公司应用和商户凭据，尚未真实联调，首页真实入口也未开放。

Use mock mode for now. Website OAuth and API v3 Native code exist, but company app and merchant credentials are missing. Live testing is pending, and the homepage has no active live entry.

拿到凭据后，按 `.env.example` 填微信应用、商户、API v3 密钥、证书序列号和验签公钥。保留 `PAYMENT_MODE=sandbox`，设 `WECHAT_MODE=live`，配置公网通知地址和网站授权回调域名。还要接好真实入口再测试；真实微信付款会扣真钱。

Once credentials are available, fill in the WeChat app, merchant, API v3 key, certificate serial, and verification key fields from `.env.example`. Keep `PAYMENT_MODE=sandbox`, set `WECHAT_MODE=live`, and configure the public notification URL and website callback domain. Connect the live entry before testing; live WeChat payments use real money.

`PAYMENT_MODE=mock` 时全部模拟。支付宝正式付款尚未实现，不要把 `live` 当成已经可用。

`PAYMENT_MODE=mock` keeps everything simulated. Live Alipay payment is not implemented.

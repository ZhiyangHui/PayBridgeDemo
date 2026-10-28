# 支付接入 / Payment setup

## 启动 / Start

```bash
npm run dev
# 或 / or
./start.sh
```

`PAYMENT_MODE=mock` 只启动本地网站。`sandbox` 会先启动 Cloudflare 隧道，给本次运行注入新的通知和返回地址，再启动网站并检查公网连通。看到“启动完成”再测试付款。

Mock mode starts only the local app. Sandbox mode starts a Cloudflare tunnel, supplies fresh callback URLs, then starts the app and checks public connectivity. Wait for “启动完成” before testing payments.

临时地址不写进 `.env.local`，密钥不会改动。本次地址记在忽略提交的 `.local/dev-runtime.json`。按 Ctrl+C 同时停止网站和隧道；端口占用会提示退出，不会杀掉其他进程。隧道退出或连续三次检查失败，会关闭本次网站，重新运行命令即可。

Temporary URLs stay out of `.env.local`; keys are untouched. Current addresses are recorded in the ignored `.local/dev-runtime.json`. Ctrl+C stops both processes. An occupied port fails safely. A tunnel exit or three consecutive failed checks stops the app; run the command again to restart.

## 支付宝沙箱 / Alipay sandbox

先安装 [cloudflared](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。启动器也能使用已有的 `.local/bin/cloudflared`，不自动下载安装。

Install cloudflared first. The launcher also accepts an existing `.local/bin/cloudflared`; it does not download software automatically.

在支付宝开放平台沙箱控制台获取 App ID、应用私钥、支付宝公钥和商户 PID，填入 `.env.local`：

Get the sandbox App ID, application private key, Alipay public key, and merchant PID, then fill in `.env.local`:

```dotenv
PAYMENT_MODE=sandbox
ALIPAY_LOGIN_MODE=mock
WECHAT_MODE=mock
APP_URL=http://localhost:3000
ALIPAY_APP_ID=your-sandbox-app-id
ALIPAY_SELLER_ID=your-sandbox-merchant-pid
ALIPAY_PRIVATE_KEY=your-application-private-key
ALIPAY_PUBLIC_KEY=your-alipay-public-key
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

运行后打开终端显示的网站地址 → 支付宝登录 → 沙箱 → 登录本站账号 → 购买 → 选择支付宝 → 用沙箱版支付宝买家账号付款。通知验签或主动查单后才更新订单，浏览器跳回来不算付款凭证。

Open the printed app URL → Alipay login → sandbox → local sign-in → buy → Alipay → pay with a sandbox buyer account. Only verified notifications or status queries update payment status; a browser redirect is not payment confirmation.

手机访问网站时用 `npm run dev -- --public`，全程使用终端显示的公网地址。若启用真实 OAuth，还需自己更新平台控制台的授权回调地址；启动器不会修改第三方控制台。

For phone access, use `npm run dev -- --public` and the printed public URL throughout. If using real OAuth, update its callback address in the provider console separately; the launcher cannot change third-party settings.

## 微信 / WeChat

当前使用模拟模式。网站 OAuth 和 API v3 Native 代码已有，缺公司应用和商户凭据，尚未真实联调。拿到凭据后按 `.env.example` 填好，设 `WECHAT_MODE=live`，使用公网模式并配置平台授权回调。

WeChat currently uses mock mode. Website OAuth and API v3 Native code exist, but live testing awaits company app and merchant credentials. Fill in `.env.example` fields, set `WECHAT_MODE=live`, use public mode, and configure the provider callback before testing.

真实微信付款会扣真钱；支付宝正式付款尚未实现。`PAYMENT_MODE=live` 使用自己的固定站点和回调配置，不创建临时隧道。

Live WeChat payments use real money; live Alipay payment is not implemented. `PAYMENT_MODE=live` uses your fixed site and callback configuration, without a temporary tunnel.

## 已打开的旧收银台 / Existing checkout pages

临时隧道每次启动都会换域名，旧收银台无法改回调地址。重启后不要继续用旧付款页；已付款就进历史订单查结果，不要重复付款。需要跨重启保留旧地址时，必须使用固定域名的隧道。

Each restart creates a new temporary hostname. Existing checkout pages retain their old callback URL. After restarting, avoid old checkout pages; if already paid, check order history instead of paying again. A fixed-domain tunnel is required to preserve old links across restarts.

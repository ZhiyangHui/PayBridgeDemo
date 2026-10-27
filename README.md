# payBridge Demo

一个练习微信、支付宝登录和付款的小项目。现在已经能用模拟账号走完“注册 → 登录 → 买东西 → 扣余额 → 查看订单”。支付宝沙箱付款也已跑通：在官方收银台付款后，支付宝通知后端，订单变为已支付。

## 现在能做什么

- 自己注册账号、设置密码和初始余额，退出后可以重新登录。
- 登录后调整模拟余额，购买 0.01 元的测试商品。
- 使用登录账号对应的方式模拟付款，查看自己的订单和付款结果。
- 余额不足时会提示，补足后可以继续付款；也可以取消未付款订单。
- 重复点击付款不会重复扣钱，账号、余额和订单重启后仍会保留。
- 支付宝沙箱已完成一笔 0.01 元付款，后端验签处理实际支付通知，订单更新为已支付。

付款时，后端会检查支付通知的签名、订单和金额，再一起更新余额和订单。不会只凭页面跳转就认为付款成功。

**`PAYMENT_MODE=mock` 时只使用模拟余额；支付宝沙箱使用沙箱资金；微信 `live` 会扣真实的钱。** 页面上的 `MOCK MODE` 就是模拟模式。这里注册的账号只在本项目中使用，不是微信或支付宝的真实账号。

## 还差什么

- **微信真实联调**：网站应用 OAuth 和 API v3 Native 代码已实现，凭据留空。没有公司提供的应用和商户信息，尚未实际扫码登录或付款。

- **支付宝沙箱登录**：已加上资料服务异常时的登录降级，使用支付宝验证过的用户 ID，显示默认昵称和头像。资料查询已改用 API v3，换码暂时保留 v2，方便对照故障；还需重新扫码验证真实昵称和头像。
- **交付检查**：还要验证全新下载后的安装运行，补齐真实接入说明，录制演示视频。

模拟流程跑通不等于整个任务已经完成，真实平台的结果还需要单独验证。

## 怎么运行

需要 Node.js 24 或更新版本。第一次运行：

```bash
cp .env.example .env.local
npm install
./start.sh
```

打开 [http://localhost:3000](http://localhost:3000)。启动时会自动创建数据库，不用自己建表。

如果已经有 `.env.local`，不要重新复制覆盖。使用模拟模式时，确认里面是：

```dotenv
APP_URL=http://localhost:3000
PAYMENT_MODE=mock
```

改完后重启服务。模拟模式不需要填写真实密钥，也不需要公网地址。

## 怎么试

首页的“支付宝沙箱”先使用本站模拟账号登录，购买后才跳转支付宝官方沙箱收银台。它不会发起支付宝 OAuth 授权。支付宝沙箱登录的资料查询仍未完成，相关代码保留供后续排查，不作为当前付款入口。

1. 选择微信或支付宝登录，点击“注册”，填写账号、密码和初始余额。
2. 登录后点击“购买”，使用对应的支付方式确认付款。
3. 回到商店查看余额，在“我的订单”查看付款结果。
4. 把余额调成 0 再买一次，可以测试余额不足的情况。

微信和支付宝的模拟登录账号分别注册。微信账号只用微信支付，支付宝账号只用支付宝支付。

## 支付宝沙箱付款

2026-10-26 已完成实际沙箱付款，数据库确认这笔订单由支付宝异步通知更新为已支付。主动查单已验证待支付状态，漏通知补单通过自动化测试。

先用本站的支付宝模拟账号登录，再去官方沙箱收银台付款，两步互不依赖。收银台使用支付宝提供的沙箱买家账号；本站模拟余额不会扣款。

在 `.env.local` 填好已有的沙箱 App ID、应用私钥和支付宝公钥，再设置：

```dotenv
PAYMENT_MODE=sandbox
ALIPAY_LOGIN_MODE=mock
WECHAT_MODE=mock
APP_URL=https://你的公网地址
ALIPAY_SELLER_ID=沙箱商户PID
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
ALIPAY_NOTIFY_URL=https://你的公网地址/api/pay/alipay/notify
ALIPAY_RETURN_URL=https://你的公网地址/orders
```

保持公网通道运行，重启 `./start.sh`，从公网地址进入项目。登录支付宝模拟账号后购买 0.01 元商品，在官方收银台用沙箱版支付宝付款，回到订单页查看结果。网页返回只负责展示，后端验签或查单确认后才会改成已支付；待支付订单最多每 10 秒向平台查一次。

临时公网地址变化时，要更新上面三个地址并重启。支付通知地址随下单请求发送；它和开放平台的“授权回调地址”是两回事。未付款订单可以继续支付，收银台支付有效期为 15 分钟。支付宝目前只开放沙箱付款；微信的正式付款需另行配置。

## 微信模拟支付

没有公司提供的微信凭据，先按 PDF 要求使用 mock。设置 `WECHAT_MODE=mock` 后，可以和支付宝沙箱付款一起使用，不需要切换整个项目的支付模式。

1. 首页选择微信模拟登录，注册账号并设置初始余额。
2. 购买 0.01 元商品，点击“微信支付”，订单页会显示模拟付款码。
3. 在订单页点击确认支付，后端处理签名通知后扣除模拟余额，订单显示已支付。
4. 把余额设为 0 可测试付款失败；补足余额能继续付款，也可以取消待付款订单。

二维码是本站模拟收银台地址，不是微信官方付款码。测试时直接使用页面按钮即可。微信模拟资金和支付宝沙箱资金各自独立，重复付款不会再次扣余额。

## 微信真实登录和付款

按任务要求实现了开放平台**网站应用 OAuth 扫码登录**和 **API v3 Native 扫码支付**，不是公众号登录。代码已接入现有页面、会话和订单流程；目前没有应用和商户凭据，**还没有做真实微信联调**。本地测试使用临时密钥和测试响应，不代表平台验收通过。

没有凭据时保持 `WECHAT_MODE=mock`，其他功能照常使用。拿到凭据后，只在 `.env.local` 填写：

| 配置 | 填什么 |
| --- | --- |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET` | 已审核的网站应用凭据 |
| `WECHAT_PAY_APP_ID`、`WECHAT_PAY_MCH_ID` | 已绑定且开通 Native 的支付 AppID、商户号 |
| `WECHAT_PAY_API_V3_KEY` | 32 字节 API v3 密钥，用于解密通知 |
| `WECHAT_PAY_CERT_SERIAL_NO` | 商户 API 证书序列号，用于请求签名 |
| `WECHAT_PAY_PRIVATE_KEY_PATH` | 商户私钥文件路径 |
| `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH` | 微信支付验签公钥文件路径 |
| `WECHAT_PAY_PLATFORM_KEY_ID` | 与该公钥配套的 `PUB_KEY_ID_...`；使用平台证书时填对应证书序列号 |
| `WECHAT_PAY_NOTIFY_URL` | 公网 HTTPS 地址加 `/api/pay/wechat/notify` |

登录 AppID 和支付 AppID 分开配置，不要求是同一个应用。平台公钥 ID 和商户证书序列号也不是同一个值。

继续使用已有支付宝沙箱配置，只把微信切到真实模式：

```dotenv
PAYMENT_MODE=sandbox
WECHAT_MODE=live
ALIPAY_LOGIN_MODE=mock
APP_URL=https://你的公网地址
WECHAT_PAY_NOTIFY_URL=${APP_URL}/api/pay/wechat/notify
```

`PAYMENT_MODE=mock` 会强制全部模拟。`PAYMENT_MODE=live` 要求支付宝也换成正式凭据，而支付宝正式支付尚未实现，所以当前联调使用上面的混合配置。

开放平台网站应用中配置与 `APP_URL` 一致的授权回调域名，完整登录回调为 `/api/auth/wechat/callback`。重启 `./start.sh` 后：

1. 点击微信登录，跳转微信官方二维码页。确认授权后，后端校验 state、换码并读取昵称、头像和用户标识，创建 HttpOnly 会话。
2. 购买 0.01 元商品。后端先保存订单，再向微信下单；订单页显示返回的付款二维码。
3. 微信通知到达后，后端验签、解密并核对商户和金额，再更新订单。漏通知时每十秒最多主动查单一次。

微信真实付款不扣本站模拟余额。下单超时或返回异常时保留待付款订单，从该订单页重新获取付款码；重试会先查单并沿用原订单号。已经保存的二维码会复用，暂未做自动关单和过期二维码续期。平台公钥更换后需要同步更新公钥文件和 ID 并重启。

本地联调可运行 `cloudflared tunnel --url http://localhost:3000`，把输出的 HTTPS 地址填入 `APP_URL` 和各回调地址。隧道需保持运行；域名变化后要重新配置平台和本地环境。

参考：[网站应用微信登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[支付通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791882)、[公钥验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053249)。API v3 没有独立沙箱，本项目不会把模拟付款码当成微信真实付款码。

## 代码放在哪里

```text
src/
├── app/                   页面和接口入口
│   ├── page.tsx           首页
│   ├── mock/login/        模拟账号注册、登录页面
│   ├── dashboard/         商店和余额
│   ├── checkout/          按登录渠道付款
│   ├── orders/            订单列表和详情
│   └── api/               登录、下单、支付通知等接口
├── components/            多个页面共用的组件和样式
├── server/                后端业务逻辑
│   ├── auth/              账号、密码、授权和登录状态
│   ├── orders/            订单、金额和余额扣款
│   ├── payments/          微信 Native、支付宝沙箱和通知验签
│   ├── db/                数据库连接
│   ├── config/            环境配置检查
│   ├── errors/            统一错误提示
│   └── http/              对外请求、超时和重试
└── styles/                全局样式、颜色和间距
prisma/                    数据表定义和数据库变更记录
scripts/                   启动前准备、配置检查
tests/                    自动化测试
public/                    头像等静态文件
start.sh                   本地启动脚本
.env.example               配置示例，不含真实密钥
```

改页面主要看 `src/app`，改登录、订单和支付逻辑看 `src/server`，改数据表看 `prisma/schema.prisma`。接口入口尽量保持简单，具体处理放在对应的后端模块里。

## 开发时用到的东西

Next.js / React 负责页面和后端接口，TypeScript 检查类型，原生 CSS 写样式，Prisma / SQLite 保存数据。另外用了 Zod、支付宝官方 SDK、qrcode 和 Vitest。

```bash
npm run format:check  # 检查代码排版
npm run lint          # 检查代码规范
npm run typecheck     # 检查类型
npm test              # 运行测试
npm run build         # 检查能否构建
```

测试覆盖账号、密码、余额、订单、通知验签、重复扣款，沙箱支付的签名、金额与商户校验、漏通知查单，以及登录异常处理。

微信相关代码：`src/server/auth/wechat.ts` 处理授权和用户资料，`src/server/payments/wechat-client.ts` 处理请求签名和响应验签，`src/server/payments/wechat.ts` 处理下单、通知和查单；`src/server/orders/remote.ts` 负责真实订单的幂等更新。

使用自建会话，是为了让两种平台共用 state 校验、用户记录和退出逻辑；数据库只保存会话令牌的哈希。微信使用服务端 fetch 和 Node.js crypto，支付宝使用官方 SDK。

真实密钥只放在本地 `.env.local`。环境配置、证书、数据库和 `.local/` 下的文件都不要提交到 Git。

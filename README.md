# payBridge Demo

用 Next.js 做的微信、支付宝登录和付款练习。

A small Next.js project for WeChat and Alipay login and payments.

## 现在能用什么 / What works

- 模拟账号注册、登录、设置余额、买商品、看订单。 / Mock registration, login, editable balances, purchases, and order history.
- 右上角切换中英文，刷新和换页会保留选择。 / Switch Chinese and English in the header; the choice persists across pages and reloads.
- 微信或支付宝登录后，都能在结算时选择两种付款方式。支付宝沙箱付款已跑通。 / Either login provider can choose either payment method at checkout. Alipay sandbox payment works.
- 付款通知会验签，重复通知不会重复扣款。 / Payment notifications are verified and do not charge twice.

本次交付：需求方已确认取消微信部分，已有模拟功能保留。支付宝使用本站账号登录，沙箱支付已跑通；官方登录卡在会员资料接口，客服反馈沙箱不可用，尚未完成。演示视频待录制。

Delivery scope: the requester has dropped WeChat; existing mock features remain. Alipay uses local sign-in and working sandbox payments. Official login is incomplete: profile retrieval fails, and Alipay support reported sandbox unavailability. The demo video is still pending.

## 跑起来 / Run locally

需要 Node.js 24+。已有 `.env.local` 就别覆盖。

Requires Node.js 24+. Keep your existing `.env.local` if you have one.

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 [localhost:3000](http://localhost:3000)。默认是模拟模式，不用申请账号或填支付密钥。注册本站账号后，设个余额就能买东西，数据库会自动准备好。

Open [localhost:3000](http://localhost:3000). Mock mode needs no provider account or payment keys. Register locally, set a balance, and try a purchase. The database is prepared automatically.

`./start.sh` 与 `npm run dev` 相同。沙箱模式自动启动隧道并同步回调，Ctrl+C 一起关闭；手机测试用 `npm run dev -- --public`。

`./start.sh` and `npm run dev` share the same launcher. Sandbox mode manages the tunnel and callback URLs; Ctrl+C stops both. Use `npm run dev -- --public` for phone testing.

支付宝沙箱配置见 [接入说明 / Setup](docs/setup.md)。首页选平台，再选模拟或沙箱。沙箱须先在 `.env.local` 配好并重启；模拟入口始终只扣本站余额。

See the setup guide for Alipay sandbox payments. Choose a provider, then mock or sandbox. Configure sandbox in `.env.local` and restart first. The mock entry always uses the local balance.

## 流程 / Flow

登录：本站注册或登录 → 校验回调 state → 保存会话 → 进入商店。当前演示不代表支付宝官方授权成功。

Login: local registration or sign-in → validate callback state → create session → store. This does not demonstrate official Alipay authorization.

付款：后端按商品价格建单 → 模拟付款或支付宝沙箱收银台 → 验签并核对金额、收款方 → 更新订单。漏通知时查单补回；查询失败可手动重试，不能仅凭浏览器跳转确认付款。

Payment: create a server-priced order → mock or Alipay sandbox checkout → verify signature, amount and merchant → update the order. Status queries recover missed notifications; failed queries can be retried. Browser redirects never confirm payment.

演示顺序见 [演示说明 / Demo guide](docs/demo.md)。

## 代码在哪 / Where the code lives

```text
app/                       页面和接口 / Pages and API
├── api/auth/               登录回调 / Login callbacks
├── api/pay/                下单与通知 / Payments and notifications
├── api/orders/             订单查询 / Order queries
├── dashboard/              商店 / Shop
├── checkout/               结算 / Checkout
└── orders/                 历史订单和详情 / Orders and details
lib/
├── wechat.ts、alipay.ts     平台入口 / Provider entry points
├── session.ts、db.ts        会话和数据库 / Sessions and database
├── auth/                   登录逻辑 / Login logic
├── payments/               支付逻辑 / Payment logic
└── orders/                 商品和订单 / Products and orders
components/、styles/        共用组件和样式 / Shared UI and styles
prisma/                    数据表和迁移 / Schema and migrations
scripts/                   启动准备 / Startup scripts
tests/                     测试 / Tests
```

`app/api` 接请求，调用 `lib` 处理，再返回结果。每个文件夹的 README 只说明它负责什么。

`app/api` receives requests, calls `lib`, and returns results. Each folder’s README explains its purpose.

## 开发 / Development

Next.js、TypeScript、原生 CSS、Prisma / SQLite；另用 Zod、支付宝 SDK、qrcode 和 Vitest。自建会话让两种登录共用一套处理，Cookie 使用 HttpOnly，数据库只存会话令牌的哈希。

Built with Next.js, TypeScript, plain CSS, Prisma / SQLite, Zod, the Alipay SDK, qrcode, and Vitest. Custom sessions keep both login flows together, using HttpOnly cookies and hashed session tokens in the database.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

密钥放 `.env.local`；证书、数据库和 `.local/` 不提交 Git。

Keep keys in `.env.local`. Certificates, databases, and `.local/` stay out of Git.

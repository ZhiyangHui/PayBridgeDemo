# payBridge Demo

[English](README.en.md)

一个用 Next.js 做的登录和付款小项目。可以注册本站账号、设置模拟余额、买测试商品、查看订单和申请模拟退款。支付宝沙箱付款已跑通。

支付宝登录目前用本站账号代替。官方授权能走到换取令牌，但获取用户资料失败；客服反馈沙箱不支持该接口，因此这部分没有算作完成。微信真实接入已取消，已有模拟功能保留。

## 1. 怎么运行

需要 Node.js 24+。所有配置都放在 `.env.local`

### 模拟模式（mock）

```bash
cp .env.example .env.local
npm install
npm run dev
```

启动后打开 localhost:3000，选择微信或支付宝的模拟登录入口，注册本站账号并设置模拟余额。登录后可以用这笔余额购买测试商品，再到历史订单查看付款结果；如果要测试退款，进入已付款订单的详情页申请全额退款，金额会退回本站模拟余额。

### 支付宝沙箱（sandbox）

先按下一节填好密钥，再修改 `.env.local`：

```dotenv
PAYMENT_MODE=sandbox
ALIPAY_LOGIN_MODE=mock
WECHAT_MODE=mock
APP_URL=http://localhost:3000
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

`SESSION_SECRET` 要保留模拟模式首次启动时生成的值。如果直接从沙箱开始，可用下面的命令生成一个，再填入该变量：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

安装下一节提到的隧道工具后，运行 `./start.sh`。等终端显示“启动完成”，从首页选“支付宝 → 沙箱”，登录本站账号并购买商品。付款时选支付宝，用**沙箱版支付宝的买家账号**付款。

本站余额和支付宝沙箱余额是两回事。沙箱付款不会扣本站余额。

### 正式环境（live）

暂不支持正式环境，目前只提供模拟和支付宝沙箱测试。

## 2. 支付宝沙箱密钥放哪里

进入[支付宝开放平台](https://open.alipay.com/)登陆注册然后进入控制台中的的沙箱控制台，在“沙箱应用”里找应用信息和接口密钥，在“沙箱账号”里找商家和买家信息。把下面四项填进 `.env.local`：
https://blog.csdn.net/ljw_993013755/article/details/138825736 可以看这个链接里面的“一、支付环境准备”

| 配置名 | 填什么 |
| --- | --- |
| `ALIPAY_APP_ID` | 沙箱应用的 APPID |
| `ALIPAY_SELLER_ID` | 沙箱商家的 PID |
| `ALIPAY_PRIVATE_KEY` | 应用私钥，使用 PKCS8 格式 |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥，不是应用公钥 |

买家账号只用来登录沙箱版支付宝付款，不用写进项目配置。密钥、证书和本地数据库都不提交 Git。

## 3. 回调地址怎么连到本地

先安装 [cloudflared](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)，确保终端能找到这个命令。项目也支持放在 `.local/bin/cloudflared`。

安装 cloudflared 后，在沙箱模式运行 ./start.sh，网站和隧道会一起启动，回调地址自动配置。打开 localhost:3000 就能测试，结束时按 Ctrl+C 关闭。

隧道断了就重新启动；已经付过款的，到历史订单查结果，不要重复付款。

## 4. 登录和付款怎么走

### 当前登录流程

1. 首页选择微信或支付宝，再选择模拟或沙箱。
2. 有本站账号就直接登录，没有就先注册。
3. 登录后进入商店，可以买商品、查看历史订单，用完点击退出。

### 付款流程

1. 在商店选择商品，点击购买，再选择付款方式。
2. 模拟付款直接在本站确认，使用本站模拟余额；支付宝沙箱付款会跳到支付宝收银台，使用沙箱买家账号付款。
3. 付款后进入订单页查看结果，成功后订单显示“已支付”。历史订单里也能查看之前的购买记录。

## 5. 还没做好的地方

支付宝沙箱登录暂时用不了，客服反馈接口不支持，所以现在用本站账号登录。
目前不支持正式付款，退款也只支持模拟订单。
临时隧道有时会断，重启后地址会变。后续考虑换成固定地址。

## 代码和检查

`app/api` 接收请求，调用 `lib` 处理，再返回结果。使用 Next.js App Router、严格模式 TypeScript、Prisma / SQLite；另外用了 Zod、支付宝 SDK、qrcode 和 Vitest。

```bash
npm test：运行自动测试。
npm run lint：检查代码规范。
npm run typecheck：检查类型错误。
npm run format:check：检查代码格式。
npm run build：编译、打包项目
```

## 详细文件结构

下面列出主要代码和配置文件，省略各目录的 README、安装依赖和自动生成文件。

```text
payBridge Demo/
├── app/
│   ├── page.tsx  # 首页，选择登录平台
│   ├── layout.tsx  # 页面共用布局
│   ├── error.tsx  # 页面出错时的提示
│   ├── page.module.css  # 首页样式
│   ├── login/
│   │   └── [provider]/
│   │       └── page.tsx  # 选择模拟或沙箱
│   ├── mock/
│   │   └── login/
│   │       └── [provider]/
│   │           └── page.tsx  # 本站账号注册和登录
│   ├── login-error/
│   │   └── page.tsx  # 登录失败提示
│   ├── dashboard/
│   │   └── page.tsx  # 商店、账户和模拟余额
│   ├── checkout/
│   │   └── page.tsx  # 商品结算和付款方式
│   ├── orders/
│   │   ├── page.tsx  # 历史订单
│   │   └── [id]/
│   │       └── page.tsx  # 订单详情、付款和模拟退款
│   └── api/
│       ├── auth/
│       │   ├── alipay/
│       │   │   ├── start/
│       │   │   │   └── route.ts  # 开始支付宝登录流程
│       │   │   ├── sandbox/
│       │   │   │   └── start/
│       │   │   │       └── route.ts  # 沙箱 OAuth 调试入口
│       │   │   └── callback/
│       │   │       └── route.ts  # 接收支付宝登录回调
│       │   ├── wechat/
│       │   │   ├── start/
│       │   │   │   └── route.ts  # 开始微信登录流程
│       │   │   └── callback/
│       │   │       └── route.ts  # 接收微信登录回调
│       │   └── logout/
│       │       └── route.ts  # 退出登录
│       ├── pay/
│       │   ├── alipay/
│       │   │   ├── create/
│       │   │   │   └── route.ts  # 创建支付宝付款订单
│       │   │   ├── notify/
│       │   │   │   └── route.ts  # 接收支付宝付款通知
│       │   │   └── return/
│       │   │       └── route.ts  # 付款后返回本站
│       │   └── wechat/
│       │       ├── create/
│       │       │   └── route.ts  # 创建微信付款订单
│       │       └── notify/
│       │           └── route.ts  # 接收微信付款通知
│       ├── orders/
│       │   └── [id]/
│       │       └── route.ts  # 查询当前用户的订单状态
│       ├── mock/
│       │   ├── auth/
│       │   │   ├── alipay/
│       │   │   │   └── route.ts  # 支付宝模拟账号注册和登录
│       │   │   └── wechat/
│       │   │       └── route.ts  # 微信模拟账号注册和登录
│       │   ├── pay/
│       │   │   └── [id]/
│       │   │       └── route.ts  # 模拟付款、取消和退款
│       │   └── wallet/
│       │       └── route.ts  # 调整本站模拟余额
│       └── health/
│           └── route.ts  # 检查服务和数据库是否正常
├── lib/
│   ├── alipay.ts  # 统一导出支付宝相关功能
│   ├── wechat.ts  # 统一导出微信相关功能
│   ├── session.ts  # 读取登录状态、设置和清除 Cookie
│   ├── db.ts  # 数据库连接
│   ├── db/
│   │   └── url.ts  # 处理数据库文件路径
│   ├── auth/
│   │   ├── routes.ts  # 处理登录入口、回调和退出
│   │   ├── store.ts  # 保存用户、登录校验信息和会话
│   │   ├── mock-accounts.ts  # 本站账号、密码和余额
│   │   ├── mock.ts  # 生成和检查模拟登录凭据
│   │   ├── alipay.ts  # 支付宝授权、换令牌和获取资料
│   │   ├── alipay-diagnostics.ts  # 支付宝接口错误诊断
│   │   ├── wechat.ts  # 微信授权和获取资料
│   │   └── types.ts  # 登录相关类型
│   ├── payments/
│   │   ├── routes.ts  # 处理下单、通知和模拟付款请求
│   │   ├── alipay.ts  # 支付宝沙箱收银台、通知和查单
│   │   ├── notification.ts  # 检查付款通知签名和内容
│   │   ├── handler.ts  # 处理模拟付款通知
│   │   ├── mock-provider.ts  # 生成带签名的模拟通知
│   │   ├── mock-keys.ts  # 生成和读取本地测试密钥
│   │   ├── mode.ts  # 判断当前使用哪种支付环境
│   │   ├── return.ts  # 处理付款后返回本站的地址
│   │   ├── wechat.ts  # 微信 Native 下单、通知和查单
│   │   └── wechat-client.ts  # 微信支付请求签名和接口调用
│   ├── orders/
│   │   ├── catalog.ts  # 测试商品和价格
│   │   ├── service.ts  # 模拟订单、余额扣减和取消
│   │   ├── sandbox.ts  # 支付宝沙箱订单保存和状态更新
│   │   ├── remote.ts  # 微信真实订单保存和状态更新
│   │   ├── history.ts  # 读取和筛选历史订单
│   │   ├── refund.ts  # 模拟订单全额退款
│   │   ├── polling.ts  # 定时查询订单，处理停止和重试
│   │   ├── status.ts  # 订单状态名称
│   │   └── money.ts  # 金额格式和元、分转换
│   ├── config/
│   │   ├── env.ts  # 读取并检查配置
│   │   └── credentials.ts  # 检查平台密钥格式
│   ├── errors/
│   │   ├── app-error.ts  # 错误类型和提示
│   │   └── response.ts  # 记录错误并返回接口响应
│   ├── http/
│   │   └── request.ts  # 接口请求和超时处理
│   └── i18n/
│       ├── messages.ts  # 中英文页面文案
│       ├── index.ts  # 语言选择和翻译方法
│       └── server.ts  # 服务端读取当前语言
├── components/
│   ├── AccountNav.tsx  # 商店、订单和退出导航
│   ├── UserAvatar.tsx  # 用户头像
│   ├── PageShell.tsx  # 页面外框和标题
│   ├── LanguageProvider.tsx  # 中英文切换
│   ├── FormMessage.tsx  # 表单错误提示
│   ├── OrderPoller.tsx  # 订单查询状态和重试按钮
│   ├── PageShell.module.css  # 页面外框样式
│   └── shop.module.css  # 商店和订单样式
├── styles/
│   ├── globals.css  # 全局样式
│   └── tokens.css  # 共用颜色、间距等
├── prisma/
│   ├── schema.prisma  # 用户、会话、订单等数据表
│   └── migrations/  # 数据库变更记录
├── scripts/
│   ├── dev.ts  # 启动网站和隧道
│   ├── dev/
│   │   └── runtime.ts  # 进程管理、地址生成和连通检查
│   ├── prepare-dev.ts  # 启动前检查配置和准备数据库
│   └── check-env.ts  # 检查运行配置
├── tests/
│   ├── unit/  # 登录、配置、请求和订单查询等单元测试
│   └── integration/  # 登录、付款、通知、退款和启动流程测试
├── public/
│   └── avatars/  # 模拟账号头像
├── docs/
│   └── setup.md  # 支付配置和隧道使用说明
├── .env.example  # 配置示例，不含真实密钥
├── .gitignore  # 不提交 Git 的文件规则
├── start.sh  # 项目启动命令
├── package.json  # 依赖和运行命令
├── package-lock.json  # 锁定依赖版本
├── next.config.ts  # Next.js 配置
├── tsconfig.json  # TypeScript 配置
├── prisma.config.ts  # Prisma 配置
├── eslint.config.mjs  # 代码检查规则
├── vitest.config.ts  # 测试配置
├── README.md  # 中文说明
├── README.en.md  # 英文说明
└── LICENSE  # MIT 开源许可证
```

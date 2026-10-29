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

```text
app/          页面和 API 路由
lib/          登录、支付、订单、会话和数据库逻辑
components/   共用页面组件
styles/       原生 CSS
prisma/       数据表和迁移
scripts/      启动、配置检查和隧道管理
tests/        单元测试和流程测试
```

`app/api` 接收请求，调用 `lib` 处理，再返回结果。使用 Next.js App Router、严格模式 TypeScript、Prisma / SQLite；另外用了 Zod、支付宝 SDK、qrcode 和 Vitest。

```bash
npm test：运行自动测试。
npm run lint：检查代码规范。
npm run typecheck：检查类型错误。
npm run format:check：检查代码格式。
npm run build：编译、打包项目
```


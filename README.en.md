# payBridge Demo

[Read the Chinese README / 查看中文版](README.md)

A small Next.js app for login and payments. You can register a local account, set a mock balance, buy test items, view orders, and request mock refunds. Alipay sandbox payment has been tested successfully.

Alipay login currently uses local accounts instead. Official authorization reaches the token exchange, but fetching user information fails. Alipay support reported that the sandbox does not support this interface, so this part is still incomplete. Real WeChat integration has been dropped; the existing mock features remain.

## 1. Run the app

Requires Node.js 24+. Put all configuration in `.env.local`.

### Mock mode

```bash
cp .env.example .env.local
npm install
npm run dev
```

After startup, open [the local app at localhost:3000](http://localhost:3000), choose mock login under WeChat or Alipay, register a local account, and set a mock balance. Use that balance to buy test items, then check the payment result in order history. To test a refund, open a paid order and request a full refund. The amount will return to your local mock balance.

### Alipay sandbox

Fill in the keys described in section 2, then update `.env.local`:

```dotenv
PAYMENT_MODE=sandbox
ALIPAY_LOGIN_MODE=mock
WECHAT_MODE=mock
APP_URL=http://localhost:3000
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

Keep the `SESSION_SECRET` generated during your first mock startup. If you start directly in sandbox mode, generate a value with this command and put it in `SESSION_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Install the tunnel tool described in section 3, then run `./start.sh`. Wait for “启动完成” (startup complete). On the home page, choose Alipay → sandbox, sign in with a local account, and buy an item. Select Alipay at checkout and pay with a **sandbox buyer account in the Alipay sandbox app**.

The local balance and Alipay sandbox balance are separate. Sandbox payments do not deduct from the local balance.

### Live mode

Live mode is not supported. This project currently supports mock testing and Alipay sandbox testing only.

## 2. Get the Alipay sandbox keys

Sign in or register on the [Alipay Open Platform website](https://open.alipay.com/), then open the sandbox console from the main console. Find application details and interface keys under “沙箱应用” (sandbox application), and merchant and buyer details under “沙箱账号” (sandbox accounts). Put these four values in `.env.local`:

| Variable | What to enter |
| --- | --- |
| `ALIPAY_APP_ID` | Sandbox application APPID |
| `ALIPAY_SELLER_ID` | Sandbox merchant PID |
| `ALIPAY_PRIVATE_KEY` | Application private key in PKCS8 format |
| `ALIPAY_PUBLIC_KEY` | Alipay public key, not the application public key |

For a walkthrough, see section “一、支付环境准备” (Payment environment preparation) in this [Alipay setup tutorial on CSDN (Chinese)](https://blog.csdn.net/ljw_993013755/article/details/138825736).

Use the buyer account only to sign in and pay in the Alipay sandbox app. It does not need to go in the project configuration. Keep keys, certificates, and local databases out of Git.

## 3. Let callbacks reach your computer

Install `cloudflared` using the [official Cloudflare Quick Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) and make sure the command is available in your terminal. The project also accepts `.local/bin/cloudflared`.

Run `./start.sh` in sandbox mode to start both the app and tunnel. Callback URLs are configured automatically. Open [the local app at localhost:3000](http://localhost:3000) to test, and press `Ctrl+C` when finished.

If the tunnel goes down, restart the app. If you have already paid, check order history instead of paying again.

## 4. Login and payment flows

### Current login flow

1. Choose WeChat or Alipay on the home page, then select mock or sandbox mode.
2. Sign in with your local account, or register if you do not have one.
3. After signing in, browse the store, buy items, and view past orders. Click Sign out when finished.

### Payment flow

1. Choose an item in the store, click Buy, and select a payment method.
2. For mock payments, confirm on the website using your local mock balance. For Alipay sandbox payments, pay at the Alipay checkout with a sandbox buyer account.
3. After paying, open the order page to check the result. Successful payments show as Paid. You can also find previous purchases in order history.

## 5. What is still missing

- Alipay sandbox login is unavailable. Support reported that the interface is not supported, so the app uses local accounts instead.
- Live payments are not supported. Refunds work only for mock orders.
- The temporary tunnel can disconnect, and its address changes after a restart. A fixed address is a possible next step.

## Code and checks

`app/api` receives requests, calls `lib`, and returns results. The app uses Next.js App Router, TypeScript in strict mode, Prisma / SQLite, plus Zod, the Alipay SDK, qrcode, and Vitest.

```bash
npm test              # Run automated tests
npm run lint          # Check code for lint issues
npm run typecheck     # Check for type errors
npm run format:check  # Check code formatting
npm run build         # Compile and build the project
```

## Detailed file structure

Main source and configuration files are listed below. Folder READMEs, installed dependencies, and generated files are omitted.

```text
payBridge Demo/
├── app/
│   ├── page.tsx  # Home page and login options
│   ├── layout.tsx  # Shared page layout
│   ├── error.tsx  # Page error screen
│   ├── page.module.css  # Home page styles
│   ├── login/
│   │   └── [provider]/
│   │       └── page.tsx  # Mock or sandbox selection
│   ├── mock/
│   │   └── login/
│   │       └── [provider]/
│   │           └── page.tsx  # Local registration and login
│   ├── login-error/
│   │   └── page.tsx  # Login error screen
│   ├── dashboard/
│   │   └── page.tsx  # Store, account, and mock balance
│   ├── checkout/
│   │   └── page.tsx  # Checkout and payment methods
│   ├── orders/
│   │   ├── page.tsx  # Order history
│   │   └── [id]/
│   │       └── page.tsx  # Order details, payment, and mock refunds
│   └── api/
│       ├── auth/
│       │   ├── alipay/
│       │   │   ├── start/
│       │   │   │   └── route.ts  # Start Alipay login
│       │   │   ├── sandbox/
│       │   │   │   └── start/
│       │   │   │       └── route.ts  # Sandbox OAuth testing entry
│       │   │   └── callback/
│       │   │       └── route.ts  # Alipay login callback
│       │   ├── wechat/
│       │   │   ├── start/
│       │   │   │   └── route.ts  # Start WeChat login
│       │   │   └── callback/
│       │   │       └── route.ts  # WeChat login callback
│       │   └── logout/
│       │       └── route.ts  # Sign out
│       ├── pay/
│       │   ├── alipay/
│       │   │   ├── create/
│       │   │   │   └── route.ts  # Create Alipay payment
│       │   │   ├── notify/
│       │   │   │   └── route.ts  # Alipay payment notification
│       │   │   └── return/
│       │   │       └── route.ts  # Return from Alipay checkout
│       │   └── wechat/
│       │       ├── create/
│       │       │   └── route.ts  # Create WeChat payment
│       │       └── notify/
│       │           └── route.ts  # WeChat payment notification
│       ├── orders/
│       │   └── [id]/
│       │       └── route.ts  # Query the user's order status
│       ├── mock/
│       │   ├── auth/
│       │   │   ├── alipay/
│       │   │   │   └── route.ts  # Alipay mock registration and login
│       │   │   └── wechat/
│       │   │       └── route.ts  # WeChat mock registration and login
│       │   ├── pay/
│       │   │   └── [id]/
│       │   │       └── route.ts  # Mock payment, cancellation, and refund
│       │   └── wallet/
│       │       └── route.ts  # Edit the local mock balance
│       └── health/
│           └── route.ts  # App and database health check
├── lib/
│   ├── alipay.ts  # Alipay exports
│   ├── wechat.ts  # WeChat exports
│   ├── session.ts  # Session access and cookies
│   ├── db.ts  # Database connection
│   ├── db/
│   │   └── url.ts  # Database file paths
│   ├── auth/
│   │   ├── routes.ts  # Login, callback, and logout handling
│   │   ├── store.ts  # Users, login state, and sessions
│   │   ├── mock-accounts.ts  # Local accounts, passwords, and balances
│   │   ├── mock.ts  # Mock login credentials
│   │   ├── alipay.ts  # Alipay authorization, tokens, and profiles
│   │   ├── alipay-diagnostics.ts  # Alipay error diagnostics
│   │   ├── wechat.ts  # WeChat authorization and profiles
│   │   └── types.ts  # Login types
│   ├── payments/
│   │   ├── routes.ts  # Payment request handling
│   │   ├── alipay.ts  # Alipay sandbox checkout, notifications, and queries
│   │   ├── notification.ts  # Payment signature and content checks
│   │   ├── handler.ts  # Mock notification handling
│   │   ├── mock-provider.ts  # Signed mock notifications
│   │   ├── mock-keys.ts  # Local test keys
│   │   ├── mode.ts  # Payment mode selection
│   │   ├── return.ts  # Payment return handling
│   │   ├── wechat.ts  # WeChat Native payments, notifications, and queries
│   │   └── wechat-client.ts  # WeChat request signing and API calls
│   ├── orders/
│   │   ├── catalog.ts  # Test products and prices
│   │   ├── service.ts  # Mock orders, balance deductions, and cancellation
│   │   ├── sandbox.ts  # Alipay sandbox order storage and updates
│   │   ├── remote.ts  # Live WeChat order storage and updates
│   │   ├── history.ts  # Order history and filters
│   │   ├── refund.ts  # Full mock refunds
│   │   ├── polling.ts  # Order polling, stopping, and retries
│   │   ├── status.ts  # Order status labels
│   │   └── money.ts  # Money formatting and unit conversion
│   ├── config/
│   │   ├── env.ts  # Environment configuration checks
│   │   └── credentials.ts  # Credential format checks
│   ├── errors/
│   │   ├── app-error.ts  # Error types and messages
│   │   └── response.ts  # Error logging and responses
│   ├── http/
│   │   └── request.ts  # HTTP requests and timeouts
│   └── i18n/
│       ├── messages.ts  # Chinese and English UI text
│       ├── index.ts  # Language selection and translation
│       └── server.ts  # Server-side language selection
├── components/
│   ├── AccountNav.tsx  # Account navigation
│   ├── UserAvatar.tsx  # User avatar
│   ├── PageShell.tsx  # Page shell and title
│   ├── LanguageProvider.tsx  # Language switching
│   ├── FormMessage.tsx  # Form error messages
│   ├── OrderPoller.tsx  # Order polling status and retry button
│   ├── PageShell.module.css  # Page shell styles
│   └── shop.module.css  # Store and order styles
├── styles/
│   ├── globals.css  # Global styles
│   └── tokens.css  # Shared colors and spacing
├── prisma/
│   ├── schema.prisma  # User, session, and order schema
│   └── migrations/  # Database migrations
├── scripts/
│   ├── dev.ts  # App and tunnel launcher
│   ├── dev/
│   │   └── runtime.ts  # Processes, URLs, and connectivity checks
│   ├── prepare-dev.ts  # Startup preparation and database setup
│   └── check-env.ts  # Runtime configuration validation
├── tests/
│   ├── unit/  # Unit tests for login, configuration, requests, and polling
│   └── integration/  # Integration tests for login, payments, notifications, refunds, and startup
├── public/
│   └── avatars/  # Mock account avatars
├── docs/
│   └── setup.md  # Payment and tunnel setup
├── .env.example  # Example configuration without real keys
├── .gitignore  # Files excluded from Git
├── start.sh  # Startup command
├── package.json  # Dependencies and commands
├── package-lock.json  # Locked dependency versions
├── next.config.ts  # Next.js configuration
├── tsconfig.json  # TypeScript configuration
├── prisma.config.ts  # Prisma configuration
├── eslint.config.mjs  # Lint rules
├── vitest.config.ts  # Test configuration
├── README.md  # Chinese README
├── README.en.md  # English README
└── LICENSE  # MIT license
```

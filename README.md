# payBridge Demo

用 Next.js 做微信、支付宝登录和支付，按试做任务 PDF 开发。

目前支持微信、支付宝模拟登录：确认授权后查看头像、昵称和登录渠道，也可以退出。支付尚未接入。

## 启动

建议使用 Node.js 24（版本见 `.nvmrc`）。

```bash
cp .env.example .env.local
npm install
./start.sh
```

`start.sh` 启动开发模式，页面和后端接口共用一个 Next.js 服务；按 Ctrl+C 停止。已有 `.env.local` 时无需再次复制。支付宝公网回调还需要保持 Cloudflare 隧道运行，脚本不会创建新的公网地址。

打开 http://localhost:3000（与 APP_URL 保持一致，登录入口会自动跳转到该地址）。首次启动会生成数据库、执行迁移，并替换模拟模式的会话密钥；无需填写真实支付凭据。`/api/health` 可检查数据库连接。

## 常用命令

```bash
npm run format      # 整理代码排版
npm run format:check # 检查排版
npm run lint        # 代码检查
npm run typecheck   # 类型检查
npm test            # 配置、请求保护、登录与会话测试
npm run build       # 生产构建
npm run db:migrate  # 修改数据模型后创建迁移
npm run db:studio   # 查看数据库
```

技术库：Next.js / React、原生 CSS + CSS Modules、Prisma / SQLite、Zod、支付宝官方 SDK、qrcode、Vitest。会话采用数据库存储，便于退出时撤销；微信签名与解密使用 Node.js crypto。

支付宝沙箱已配置，扫码授权和换码已验证；会员资料查询仍在联调，暂未完成真实登录验收。微信真实 OAuth 留到微信接入阶段。模拟测试不能代替平台验收。不要提交 `.env.local`、证书或数据库。

- [源码说明](src/README.md)
- [数据库说明](prisma/README.md)
- [测试说明](tests/README.md)

## 试用模拟登录

点击微信或支付宝登录，在模拟授权页选择确认或取消。确认后进入 `/dashboard`；退出后再次访问会返回首页。每个渠道使用一个固定测试用户。

同一浏览器同一渠道以最近发起的授权为准，授权请求 10 分钟有效，会话 7 天有效。数据库只保存令牌哈希。

支付宝沙箱配置需在本地填写对应应用 ID、PKCS8 格式的应用私钥和支付宝公钥，配置公网 HTTPS 的 APP_URL 和回调地址 `/api/auth/alipay/callback`，再切换 PAYMENT_MODE=sandbox。不要把私钥发到聊天或提交 Git；实际接口权限与沙箱授权入口仍需联调确认。

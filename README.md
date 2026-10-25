# payBridge Demo

用 Next.js 做微信、支付宝登录和支付，按试做任务 PDF 开发。

目前已搭好框架、数据库和检查工具。首页能打开，登录和支付还没接入。

## 启动

建议使用 Node.js 24（版本见 `.nvmrc`）。

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 http://localhost:3000。首次启动会生成数据库、执行迁移，并替换模拟模式的会话密钥；无需填写真实支付凭据。`/api/health` 可检查数据库连接。

## 常用命令

```bash
npm run lint        # 代码检查
npm run typecheck   # 类型检查
npm test            # 当前覆盖环境配置，支付测试随功能补充
npm run build       # 生产构建
npm run db:migrate  # 修改数据模型后创建迁移
npm run db:studio   # 查看数据库
```

技术库：Next.js / React、原生 CSS + CSS Modules、Prisma / SQLite、Zod、支付宝官方 SDK、qrcode、Vitest。会话准备采用数据库存储，便于退出时撤销；微信签名与解密使用 Node.js crypto。

真实平台配置、沙箱联调和演示视频待后续完成。不要提交 `.env.local`、证书或数据库。

- [源码说明](src/README.md)
- [数据库说明](prisma/README.md)
- [测试说明](tests/README.md)

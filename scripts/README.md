# 启动准备 / Startup scripts

`prepare-dev.ts` 在 `npm run dev` 前检查配置、准备本地会话密钥、生成客户端并执行迁移；`check-env.ts` 在 `npm start` 前检查配置。

Before `npm run dev`, `prepare-dev.ts` checks configuration, prepares the local session secret, generates the client, and applies migrations.

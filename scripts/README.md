# 启动管理 / Startup

`dev.ts` 管理开发服务和沙箱隧道，`--demo` 构建后启动、不带热更新；`dev/` 放进程、地址及连通性检查。`prepare-dev.ts` 检查配置、准备数据库；`check-env.ts` 检查正式启动配置。

`dev.ts` manages the app and sandbox tunnel; `--demo` builds and runs without hot reload; `dev/` handles processes, URLs, and connectivity. `prepare-dev.ts` prepares configuration and the database; `check-env.ts` checks production startup settings.

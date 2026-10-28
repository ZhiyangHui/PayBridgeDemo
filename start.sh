#!/usr/bin/env bash
# 启动本地开发服务，Next.js 同时提供页面和后端接口。
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# 先检查运行条件，具体配置由启动管理器校验。
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "启动失败：请先安装 Node.js 24（包含 npm）。" >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "启动失败：Node.js 版本需要 24 或以上。" >&2
  exit 1
fi
if [[ ! -f node_modules/next/package.json || ! -x node_modules/.bin/tsx ]]; then
  echo "启动失败：请先在项目目录运行 npm install。" >&2
  exit 1
fi
if [[ ! -f .env.local ]]; then
  echo "启动失败：请复制 .env.example 为 .env.local，再填写配置。" >&2
  exit 1
fi

# 与 npm run dev 共用启动管理；沙箱模式自动启动隧道并同步回调地址。
exec node --import tsx scripts/dev.ts "$@"

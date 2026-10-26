#!/usr/bin/env bash
# 启动本地开发服务，Next.js 同时提供页面和后端接口。
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# 先检查运行条件，配置内容由现有 predev 校验。
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

# 固定端口，避免端口占用时切换端口导致公网隧道连接到错误服务。
echo "准备启动：http://localhost:3000（按 Ctrl+C 停止）"
echo "支付宝公网回调还需要单独保持 Cloudflare 隧道运行。"
exec npm run dev -- --hostname 127.0.0.1 --port 3000

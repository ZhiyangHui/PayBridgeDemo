import type { NextConfig } from "next";

// 只允许当前配置的站点访问开发资源，隧道域名由 .env.local 管理。
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).hostname] : [],
};
export default config;

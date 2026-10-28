import type { NextConfig } from "next";

// 只允许当前配置的站点访问开发资源，隧道域名由启动管理器传入。
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: [process.env.APP_URL, process.env.PAYBRIDGE_TUNNEL_URL]
    .filter((url): url is string => Boolean(url))
    .map((url) => new URL(url).hostname),
};
export default config;

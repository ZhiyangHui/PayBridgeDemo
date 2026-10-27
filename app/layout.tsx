import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "payBridge Demo",
  description: "微信与支付宝登录、支付演示",
};

/**
 * 为所有页面提供 HTML 文档和主体容器，将文档语言设为简体中文。
 * @param children 当前路由渲染的页面内容；全局样式在本文件导入。
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "@/styles/globals.css";
export const metadata: Metadata = { title: "payBridge Demo", description: "微信与支付宝登录、支付演示" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

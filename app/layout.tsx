import { getTranslations } from "@/lib/i18n/server";
import { LanguageProvider } from "@/components/LanguageProvider";
import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "payBridge Demo",
  description: "微信与支付宝登录、支付演示",
};

/**
 * 为所有页面提供 HTML 文档和主体容器，按用户选择设置文档语言。
 * @param children 当前路由渲染的页面内容；全局样式在本文件导入。
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getTranslations();

  return (
    <html lang={locale}>
      <body>
        <LanguageProvider locale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}

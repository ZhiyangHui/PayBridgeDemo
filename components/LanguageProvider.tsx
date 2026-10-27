"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGE_COOKIE, translations, type Locale } from "@/lib/i18n";
import styles from "./PageShell.module.css";

const LanguageContext = createContext<Locale>("zh-CN");

/** 将服务端读取的语言传给交互组件，保证首次显示一致。 */
export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}

/** 读取交互组件使用的语言和翻译函数。 */
export function useTranslations() {
  return translations(useContext(LanguageContext));
}

/** 保存语言偏好并刷新当前页面，保留网址、登录状态和表单。 */
export function LanguageToggle() {
  const { locale } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";

  /** 只更新语言 Cookie，随后重新获取当前页面的服务端文案。 */
  function switchLanguage() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANGUAGE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    startTransition(() => router.refresh());
  }

  return (
    <button
      className={styles.languageButton}
      type="button"
      onClick={switchLanguage}
      disabled={pending}
      aria-label={locale === "zh-CN" ? "Switch to English" : "切换为中文"}
      lang={nextLocale}
    >
      {locale === "zh-CN" ? "English" : "中文"}
    </button>
  );
}

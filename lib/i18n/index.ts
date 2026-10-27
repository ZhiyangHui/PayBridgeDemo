import { english } from "./messages";

/** 支持的界面语言。 */
export type Locale = "zh-CN" | "en";
export const LANGUAGE_COOKIE = "paybridge_language";

/** 未设置或无效的语言值统一回退到中文。 */
export function parseLocale(value?: string): Locale {
  return value === "en" ? "en" : "zh-CN";
}

/** 翻译界面文案并填入参数，找不到翻译时保留原文。 */
export function translate(
  locale: Locale,
  text: string,
  values: Record<string, string | number> = {},
) {
  const message = locale === "en" && Object.hasOwn(english, text) ? english[text] : text;

  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}

/** 为当前语言创建页面使用的翻译函数。 */
export function translations(locale: Locale) {
  return {
    locale,
    t: (text: string, values?: Record<string, string | number>) => translate(locale, text, values),
  };
}

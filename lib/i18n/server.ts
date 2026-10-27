import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LANGUAGE_COOKIE, parseLocale, translations } from "./index";

/** 读取本次请求的语言偏好，供服务端页面和布局共用。 */
export const getTranslations = cache(async () => {
  const locale = parseLocale((await cookies()).get(LANGUAGE_COOKIE)?.value);

  return translations(locale);
});

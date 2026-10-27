import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { FormMessage } from "@/components/FormMessage";
import styles from "@/components/shop.module.css";

export const dynamic = "force-dynamic";

/**
 * 显示指定渠道的模拟账号登录或注册表单。
 * 根据 tab 参数切换表单，注册时增加初始余额输入；提交时携带授权 state。
 * 渠道无效或 state 格式错误时显示 404；提交时由后端验证授权记录。
 */
export default async function MockLogin({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ state?: string; tab?: string; error?: string }>;
}) {
  const { t } = await getTranslations();
  const { provider } = await params;
  const query = await searchParams;

  if (
    (provider !== "wechat" && provider !== "alipay") ||
    !/^[a-f0-9]{64}$/.test(query.state ?? "")
  ) {
    notFound();
  }

  // 只在 tab=register 时展示注册表单，其他值均展示登录表单。
  const register = query.tab === "register";
  const base = `/mock/login/${provider}?state=${query.state}`;

  return (
    <PageShell mode="MOCK MODE">
      <h1 className={styles.heading}>
        {provider === "wechat" ? t("微信模拟账号") : t("支付宝模拟账号")}
      </h1>
      <nav className={styles.tabs} aria-label={t("账号操作")}>
        <Link href={base} aria-current={!register ? "page" : undefined}>
          {t("登录")}
        </Link>
        <Link href={`${base}&tab=register`} aria-current={register ? "page" : undefined}>
          {t("注册")}
        </Link>
      </nav>
      <FormMessage code={query.error} />
      <form action={`/api/mock/auth/${provider}`} method="post" className={styles.form}>
        <input type="hidden" name="state" value={query.state} />
        <input type="hidden" name="intent" value={register ? "register" : "login"} />
        <label>
          {t("账号")}
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            pattern="[a-zA-Z0-9_]+"
            placeholder={t("字母、数字或下划线")}
          />
        </label>
        <label>
          {t("密码")}
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={8}
            maxLength={128}
            placeholder={t("至少 8 位")}
          />
        </label>
        {register && (
          <label>
            {t("初始余额（元）")}
            <input
              name="balance"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue="100.00"
              required
            />
          </label>
        )}
        <button className={styles.button}>{register ? t("注册并登录") : t("登录")}</button>
      </form>
      <Link href="/" className={styles.back}>
        {t("返回")}
      </Link>
    </PageShell>
  );
}

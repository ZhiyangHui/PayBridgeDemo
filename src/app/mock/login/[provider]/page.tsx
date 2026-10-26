import { notFound } from "next/navigation";
import { isMockLogin } from "@/server/auth/routes";
import { PageShell } from "@/components/PageShell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/** 明确展示模拟授权，并通过同源 POST 确认或取消。 */
export default async function MockLogin({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { provider } = await params;
  const { state } = await searchParams;

  if ((provider !== "wechat" && provider !== "alipay") || !isMockLogin(provider)) {
    notFound();
  }

  if (!state || !/^[a-f0-9]{64}$/.test(state)) {
    notFound();
  }

  return (
    <PageShell mode="MOCK MODE">
      <h1>{provider === "wechat" ? "微信" : "支付宝"}模拟授权</h1>
      <p className={styles.description}>
        将使用固定测试用户登录，不会访问真实平台或获取你的个人资料。
      </p>
      <form action={`/api/mock/auth/${provider}`} method="post" className={styles.actions}>
        <input type="hidden" name="state" value={state} />
        <button name="decision" value="allow">
          确认授权
        </button>
        <button name="decision" value="deny">
          取消
        </button>
      </form>
    </PageShell>
  );
}

import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { errorDefinitions } from "@/server/errors/app-error";

/** 登录失败只展示固定提示和追踪 ID，不渲染第三方错误正文。 */
export default async function LoginError({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; ref?: string }>;
}) {
  const params = await searchParams;
  const code =
    params.code && Object.hasOwn(errorDefinitions, params.code)
      ? (params.code as keyof typeof errorDefinitions)
      : "INTERNAL_ERROR";
  const reference = /^[a-f0-9-]{36}$/.test(params.ref ?? "") ? params.ref : null;

  return (
    <PageShell>
      <h1>未能完成登录</h1>
      <p>{errorDefinitions[code][1]}</p>
      {reference && <p>参考编号：{reference}</p>}
      <Link href="/">返回首页重新登录</Link>
    </PageShell>
  );
}

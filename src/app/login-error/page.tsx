import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { errorDefinitions } from "@/server/errors/app-error";

/**
 * 根据 URL 中的错误码显示固定的登录失败提示。
 * 只接受已定义的错误码和格式正确的追踪编号，未知错误显示通用提示。
 */
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

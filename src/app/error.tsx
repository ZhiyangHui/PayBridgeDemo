"use client";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

/** 页面读取失败时提供重试入口，避免展示内部异常。 */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageShell>
      <h1>暂时无法加载页面</h1>
      <p>请稍后重试。</p>
      <button onClick={reset}>重试</button> <Link href="/">返回首页</Link>
    </PageShell>
  );
}

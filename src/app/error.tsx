"use client";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

/**
 * 显示页面加载失败提示，并提供重试和返回首页按钮。
 * @param reset Next.js 提供的重试函数，点击后重新尝试渲染当前页面。
 */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageShell>
      <h1>暂时无法加载页面</h1>
      <p>请稍后重试。</p>
      <button onClick={reset}>重试</button> <Link href="/">返回首页</Link>
    </PageShell>
  );
}

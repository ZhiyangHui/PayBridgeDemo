import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  developmentUrls,
  healthy,
  launch,
  monitorTunnel,
  requireFreePort,
  stop,
  tunnelUrl,
  waitForSite,
  waitForTunnel,
  type ManagedProcess,
} from "../../scripts/dev/runtime";

const processes: ManagedProcess[] = [];
let server: Server | undefined;

afterEach(async () => {
  await stop(processes.splice(0), 50);

  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

/** 使用独立 Node 子进程模拟隧道，不调用 Cloudflare 或读取项目密钥。 */
function child(code: string) {
  const process = launch(globalThis.process.execPath, ["-e", code], globalThis.process.env, true);
  processes.push(process);

  return process;
}

/** 启动本地健康检查服务，监听随机端口以避开开发服务。 */
async function fixture(status: number, data: unknown) {
  server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("测试服务未启动");
  }

  return { port: address.port, url: `http://127.0.0.1:${address.port}` };
}

describe("开发启动与隧道管理", () => {
  it("新启动同时更新通知和返回地址，保留本地登录域名", () => {
    const old = developmentUrls("https://old-run.trycloudflare.com");
    const next = developmentUrls("https://new-run.trycloudflare.com");
    expect(next.APP_URL).toBe("http://localhost:3000");
    expect(next.ALIPAY_NOTIFY_URL).toBe("https://new-run.trycloudflare.com/api/pay/alipay/notify");
    expect(next.ALIPAY_RETURN_URL).toBe("https://new-run.trycloudflare.com/api/pay/alipay/return");
    expect(JSON.stringify(next)).not.toContain("old-run");
    expect(old.ALIPAY_RETURN_URL).toContain("old-run");
    expect(developmentUrls("https://new-run.trycloudflare.com", true).APP_URL).toBe(
      "https://new-run.trycloudflare.com",
    );
    expect(developmentUrls().PAYBRIDGE_TUNNEL_URL).toBe("");
  });

  it("不接受伪装成 Cloudflare 的域名", () => {
    expect(tunnelUrl("https://app.trycloudflare.com.evil.test\n")).toBeNull();
    expect(() => developmentUrls("http://app.trycloudflare.com")).toThrow();
  });

  it("拼接分段隧道日志，只在完整网址输出后继续", async () => {
    const tunnel = child(
      "process.stdout.write('https://fresh-');setTimeout(()=>process.stderr.write('run.trycloudflare.com\\n'),30);setInterval(()=>{},1000);",
    );
    expect(await waitForTunnel(tunnel, new AbortController().signal, 2000)).toBe(
      "https://fresh-run.trycloudflare.com",
    );
  });

  it("隧道提前退出或始终没有网址时失败", async () => {
    await expect(
      waitForTunnel(child("process.exit(1)"), new AbortController().signal, 2000),
    ).rejects.toThrow("退出");
    await expect(
      waitForTunnel(child("setInterval(()=>{},1000)"), new AbortController().signal, 50),
    ).rejects.toThrow("超时");
  });

  it("用户取消时结束等待，清理进程后不再存活", async () => {
    const tunnel = child("setInterval(()=>{},1000)");
    const cancel = new AbortController();
    const waiting = waitForTunnel(tunnel, cancel.signal);
    cancel.abort();
    await expect(waiting).rejects.toThrow("取消");
    await stop([tunnel], 50);
    expect(() => process.kill(tunnel.child.pid!, 0)).toThrow();
  });

  it("公网连续失败才停止，一次短暂故障可以恢复", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const cancel = new AbortController();
    const report = vi.fn();

    try {
      fetcher.mockRejectedValueOnce(new Error("offline"));
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", database: "ok" })));
      fetcher.mockRejectedValue(new Error("offline"));
      const result = monitorTunnel(
        "https://test.trycloudflare.com",
        cancel.signal,
        5,
        report,
      ).catch((error) => error);
      expect(await result).toMatchObject({ message: expect.stringContaining("持续不可达") });
      expect(fetcher).toHaveBeenCalledTimes(5);
      expect(report.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining("暂时不可达"),
        expect.stringContaining("已恢复"),
        expect.stringContaining("暂时不可达"),
      ]);
    } finally {
      cancel.abort();
      vi.restoreAllMocks();
    }
  });

  it("端口占用时拒绝启动，原服务继续正常工作", async () => {
    const local = await fixture(200, { status: "ok", database: "ok" });
    await expect(requireFreePort(local.port)).rejects.toThrow("占用");
    expect(await healthy(local.url, new AbortController().signal)).toBe(true);
    await expect(
      waitForSite(local.url, new AbortController().signal, 500),
    ).resolves.toBeUndefined();
  });

  it("隧道返回错误或数据库未就绪时不能宣布可用", async () => {
    const local = await fixture(502, { status: "ok", database: "ok" });
    expect(await healthy(local.url, new AbortController().signal)).toBe(false);
    await expect(waitForSite(local.url, new AbortController().signal, 50)).rejects.toThrow(
      "尚不可达",
    );
  });
});

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** 本次启动拥有的子进程；退出结果统一返回，不产生未处理的 Promise 异常。 */
export type ManagedProcess = {
  child: ChildProcess;
  done: Promise<number>;
};

/** 读取 Cloudflare 输出中的完整临时域名，不接受相似后缀或其他网址。 */
export function tunnelUrl(output: string): string | null {
  return (
    output.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=[\s|]|$)/)?.[0] ?? null
  );
}

/** 生成本次运行的地址；不把临时域名写入用户的配置文件。 */
export function developmentUrls(origin?: string, publicSite = false): Record<string, string> {
  if (!origin) {
    return { APP_URL: "http://localhost:3000", PAYBRIDGE_TUNNEL_URL: "" };
  }

  if (tunnelUrl(origin) !== origin) {
    throw new Error("隧道返回的网址无效，已停止启动。");
  }

  return {
    APP_URL: publicSite ? origin : "http://localhost:3000",
    PAYBRIDGE_TUNNEL_URL: origin,
    ALIPAY_NOTIFY_URL: `${origin}/api/pay/alipay/notify`,
    ALIPAY_RETURN_URL: `${origin}/api/pay/alipay/return`,
    WECHAT_PAY_NOTIFY_URL: `${origin}/api/pay/wechat/notify`,
  };
}

/** 检查固定开发端口，已占用时退出，不终止其他进程或自动换端口。 */
export async function requireFreePort(port = 3000): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error(`${port} 端口已占用，请先关闭之前的项目服务。`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 优先使用项目已有的 cloudflared，否则从 PATH 查找；不自动下载程序。 */
export function findCloudflared(root: string): string {
  const candidates = [
    path.join(root, ".local/bin/cloudflared"),
    ...(process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, "cloudflared")),
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);

      return candidate;
    } catch {
      // 当前路径不可执行时继续寻找下一项。
    }
  }

  throw new Error("沙箱启动需要 cloudflared，请安装后重试；纯模拟模式不需要隧道。");
}

/** 启动独立进程组，便于退出时同时清理 Next.js 派生的工作进程。 */
export function launch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  quiet = false,
): ManagedProcess {
  const child = spawn(command, args, {
    env,
    detached: process.platform !== "win32",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const done = new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });

  return { child, done };
}

/** 结束本次启动的进程组，超时后强制清理，不查找或终止无关进程。 */
export async function stop(processes: ManagedProcess[], graceMs = 3000): Promise<void> {
  /** 按本次记录的 PID 发信号；进程已退出时忽略 ESRCH。 */
  function signal(child: ChildProcess, name: NodeJS.Signals) {
    if (!child.pid) {
      return;
    }

    try {
      if (process.platform === "win32") {
        child.kill(name);
      } else {
        process.kill(-child.pid, name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        console.error("部分开发进程未能自动关闭，请检查启动终端。");
      }
    }
  }

  processes.forEach(({ child }) => signal(child, "SIGTERM"));
  // 即使父进程先退出，也给同一进程组的工作进程留出清理时间。
  await delay(graceMs);
  processes.forEach(({ child }) => signal(child, "SIGKILL"));
  await Promise.all(processes.map(({ done }) => done));
}

/** 等待隧道域名，处理分段日志、启动失败、超时和用户取消。 */
export async function waitForTunnel(
  process: ManagedProcess,
  signal: AbortSignal,
  timeoutMs = 45000,
): Promise<string> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

  return new Promise<string>((resolve, reject) => {
    let output = "";

    /** 完成或失败后取消监听，后续日志只排空，不打印可能包含环境信息的原文。 */
    function finish(error?: Error, url?: string) {
      process.child.stdout?.off("data", read);
      process.child.stderr?.off("data", read);
      bounded.removeEventListener("abort", cancelled);
      process.child.stdout?.resume();
      process.child.stderr?.resume();

      if (error) {
        reject(error);
      } else {
        resolve(url!);
      }
    }

    /** 按完整日志行解析，防止截断的域名被误认为完整网址。 */
    function read(chunk: Buffer) {
      output = (output + chunk.toString()).slice(-16384);
      const end = output.lastIndexOf("\n");
      const url = end < 0 ? null : tunnelUrl(output.slice(0, end + 1));

      if (url) {
        finish(undefined, url);
      }
    }

    /** 用户停止或等待超时时结束本次等待。 */
    function cancelled() {
      finish(new Error("获取隧道地址超时或已取消，请检查网络后重新启动。"));
    }

    process.child.stdout?.on("data", read);
    process.child.stderr?.on("data", read);
    bounded.addEventListener("abort", cancelled, { once: true });
    void process.done.then(() => finish(new Error("隧道进程已退出，无法继续启动。")));

    if (bounded.aborted) {
      cancelled();
    }
  });
}

/** 检查网站及数据库健康状态，超时、重定向或非预期响应均视为未就绪。 */
export async function healthy(
  origin: string,
  signal: AbortSignal,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", origin), {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      cache: "no-store",
    });
    const data = await response.json();

    return response.ok && data.status === "ok" && data.database === "ok";
  } catch {
    return false;
  }
}

/** 等待网站可用；达到截止时间仍失败时阻止宣布启动成功。 */
export async function waitForSite(
  origin: string,
  signal: AbortSignal,
  timeoutMs = 60000,
): Promise<void> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

  while (!bounded.aborted) {
    if (await healthy(origin, bounded)) {
      return;
    }

    try {
      await delay(1000, undefined, { signal: bounded });
    } catch {
      break;
    }
  }

  throw new Error("网站或隧道尚不可达，请检查网络后重新启动。");
}

/** 公网连续三次不可达后退出，避免继续创建带失效回调地址的订单。 */
export async function monitorTunnel(
  origin: string,
  signal: AbortSignal,
  intervalMs = 10000,
  report: (message: string) => void = console.warn,
): Promise<void> {
  let failures = 0;

  while (!signal.aborted) {
    await delay(intervalMs, undefined, { signal });
    const available = await healthy(origin, signal);
    signal.throwIfAborted();

    // 只报告断线和恢复的时刻，不在每次检查时刷日志。
    if (!available && failures === 0) {
      report("公网暂时不可达，正在等待隧道恢复。请暂停付款，不要反复刷新页面。");
    } else if (available && failures > 0) {
      report("公网连接已恢复，可以继续测试。");
    }

    failures = available ? 0 : failures + 1;

    if (failures >= 3) {
      throw new Error("隧道持续不可达，已停止开发服务。请重新运行启动命令获取新地址。");
    }
  }
}

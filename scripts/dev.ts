import nextEnv from "@next/env";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  developmentUrls,
  findCloudflared,
  launch,
  monitorTunnel,
  requireFreePort,
  stop,
  waitForSite,
  waitForTunnel,
  type ManagedProcess,
} from "./dev/runtime";

/** 启动开发服务及所需隧道，统一管理地址、健康检查和退出清理。 */
async function main() {
  const args = process.argv.slice(2);

  if (args.some((arg) => !["--public", "--demo"].includes(arg))) {
    throw new Error(
      "用法：./start.sh [--demo] [--public]；--demo 用于演示，--public 用于手机访问。",
    );
  }

  const root = process.cwd();
  const demo = args.includes("--demo");
  nextEnv.loadEnvConfig(root, !demo);
  const mode = process.env.PAYMENT_MODE;
  const publicSite = args.includes("--public");

  if (!["mock", "sandbox", "live"].includes(mode ?? "")) {
    throw new Error("请先复制 .env.example 为 .env.local，并设置 PAYMENT_MODE。");
  }

  if (publicSite && mode !== "sandbox") {
    throw new Error("--public 只用于沙箱测试；纯模拟模式不启动公网隧道。");
  }

  await requireFreePort();
  const controller = new AbortController();
  const processes: ManagedProcess[] = [];
  let interrupted = false;
  let origin: string | undefined;
  const runtimeFile = ".local/dev-runtime.json";

  /** 用户主动退出时同时结束本次应用和隧道，不报告异常退出。 */
  function interrupt() {
    interrupted = true;
    controller.abort();
  }

  /** 记录长驻进程，任一意外退出都停止整个开发会话。 */
  function watch(process: ManagedProcess, name: string) {
    processes.push(process);
    void process.done.then(() => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(`${name}已退出，请重新运行启动命令。`));
      }
    });
  }

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    if (mode === "sandbox") {
      console.log("正在启动支付宝沙箱隧道……");
      const tunnel = launch(
        findCloudflared(root),
        ["tunnel", "--url", "http://127.0.0.1:3000", "--protocol", "http2", "--no-autoupdate"],
        process.env,
        true,
      );
      watch(tunnel, "隧道");
      origin = await waitForTunnel(tunnel, controller.signal);
    }

    const overrides = mode === "live" ? {} : developmentUrls(origin, publicSite);
    // 地址只注入当前进程，既不覆盖私钥，也不把即将失效的域名保存到 .env.local。
    const prepare = launch(process.execPath, ["--import", "tsx", "scripts/prepare-dev.ts"], {
      ...process.env,
      ...overrides,
    });
    processes.push(prepare);
    const code = await Promise.race([
      prepare.done,
      delay(180000, 1, { signal: controller.signal }),
    ]);
    controller.signal.throwIfAborted();

    if (code !== 0) {
      throw new Error("启动准备失败或超时，请查看上方配置检查结果。");
    }

    // 准备进程及其同步任务已结束，不再保留旧 PID，避免长期运行后 PID 被复用。
    processes.splice(processes.indexOf(prepare), 1);

    // 首次模拟启动可能生成会话密钥，重新读取后再交给 Next.js。
    nextEnv.loadEnvConfig(root, !demo, undefined, true);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...overrides,
      NODE_ENV: demo ? "production" : "development",
    };

    // 演示先构建静态资源，运行时不加载热更新客户端。
    if (demo) {
      console.log("正在构建演示版本，完成后自动启动……");
      const build = launch(process.execPath, ["node_modules/next/dist/bin/next", "build"], env);
      processes.push(build);
      const result = await Promise.race([
        build.done,
        delay(300000, 1, { signal: controller.signal }),
      ]);
      controller.signal.throwIfAborted();

      if (result !== 0) {
        throw new Error("演示构建失败或超时，请查看上方错误。");
      }

      processes.splice(processes.indexOf(build), 1);
    }

    // 开发使用 Webpack，避开当前 Turbopack 重复发送整页刷新指令的问题。
    const command = demo ? ["start"] : ["dev", "--webpack"];
    const app = launch(
      process.execPath,
      ["node_modules/next/dist/bin/next", ...command, "--hostname", "127.0.0.1", "--port", "3000"],
      env,
    );
    watch(app, "网站服务");
    await waitForSite("http://127.0.0.1:3000", controller.signal);

    if (origin) {
      await waitForSite(origin, controller.signal);
    }

    mkdirSync(".local", { recursive: true });
    writeFileSync(
      runtimeFile,
      JSON.stringify(
        {
          pid: process.pid,
          appUrl: env.APP_URL,
          tunnelUrl: origin,
          demo,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(`\n启动完成：${env.APP_URL}\n按 Ctrl+C 同时关闭本次网站和隧道。`);

    if (demo) {
      console.log(
        "演示模式：没有代码热更新；修改代码后需要重新启动。支付环境仍由 PAYMENT_MODE 决定。",
      );
    }

    if (origin) {
      console.log(`支付宝通知：${env.ALIPAY_NOTIFY_URL}\n返回商户：${env.ALIPAY_RETURN_URL}`);
      console.log("地址已自动同步。旧收银台链接仍可能失效，已付款请到历史订单查看，不要重复付款。");
      await monitorTunnel(origin, controller.signal);
    } else if (!controller.signal.aborted) {
      await once(controller.signal, "abort");
    }

    controller.signal.throwIfAborted();
  } catch (error) {
    if (!interrupted) {
      throw controller.signal.reason instanceof Error ? controller.signal.reason : error;
    }
  } finally {
    controller.abort();
    await stop(processes);

    // 只移除本次会话的状态文件，不覆盖其他启动留下的信息。
    try {
      if (JSON.parse(readFileSync(runtimeFile, "utf8")).pid === process.pid) {
        rmSync(runtimeFile);
      }
    } catch {
      // 启动尚未成功时可能还没有状态文件。
    }

    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

// 启动失败只输出固定说明，不打印子进程环境或密钥。
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "启动失败，请检查配置和网络。");
  process.exitCode = 1;
});

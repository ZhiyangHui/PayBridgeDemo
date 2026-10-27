import nextEnv from "@next/env";
import path from "node:path";
import { databaseUrl } from "../lib/db/url";
import { closeSync, openSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { validateCredentials } from "../lib/config/credentials";
import { parseEnv } from "../lib/config/env";

const { loadEnvConfig } = nextEnv;

// 先确认有本地配置文件或显式环境配置，缺失时停止启动。
if (!existsSync(".env.local") && !process.env.PAYMENT_MODE) {
  throw new Error("请先复制 .env.example 为 .env.local");
}

loadEnvConfig(process.cwd());

// 示例会话密钥仅在模拟模式下替换，真实模式必须显式配置。
if (process.env.PAYMENT_MODE === "mock" && process.env.SESSION_SECRET?.startsWith("replace-")) {
  mkdirSync(".local", { recursive: true });
  const file = ".local/session-secret";

  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }

  // 复用本地生成的会话密钥并替换示例占位值，避免每次启动让会话失效。
  const secret = readFileSync(file, "utf8").trim();
  const env = readFileSync(".env.local", "utf8");
  writeFileSync(".env.local", env.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`), {
    mode: 0o600,
  });
  process.env.SESSION_SECRET = secret;
}

// 在创建数据库和执行迁移之前检查环境变量及平台密钥。
validateCredentials(process.env);
const config = parseEnv(process.env);
const dbPath = databaseUrl(config.DATABASE_URL).slice(5);
mkdirSync(path.dirname(dbPath), { recursive: true });

// Prisma 首次迁移需要 SQLite 文件存在，追加打开不会清空已有数据。
closeSync(openSync(dbPath, "a"));

// 先生成 Prisma 客户端，再执行尚未应用的迁移；任一步失败都会终止启动。
for (const args of [["generate"], ["migrate", "deploy"]]) {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    stdio: "inherit",
  });
}

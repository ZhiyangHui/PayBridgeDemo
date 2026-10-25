import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import path from "node:path";
import { databaseUrl } from "../src/server/db/url";
import { closeSync, openSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseEnv } from "../src/server/config/env";
if (!existsSync(".env.local") && !process.env.PAYMENT_MODE) throw new Error("请先复制 .env.example 为 .env.local");
loadEnvConfig(process.cwd());
if (process.env.PAYMENT_MODE === "mock" && process.env.SESSION_SECRET?.startsWith("replace-")) {
  mkdirSync(".local", { recursive: true });
  const file = ".local/session-secret";
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  const secret = readFileSync(file, "utf8").trim();
  const env = readFileSync(".env.local", "utf8");
  writeFileSync(".env.local", env.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`), { mode: 0o600 });
  process.env.SESSION_SECRET = secret;
}
const config = parseEnv(process.env);
const dbPath = databaseUrl(config.DATABASE_URL).slice(5);
mkdirSync(path.dirname(dbPath), { recursive: true });
closeSync(openSync(dbPath, "a"));
for (const args of [["generate"], ["migrate", "deploy"]]) {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { stdio: "inherit" });
}

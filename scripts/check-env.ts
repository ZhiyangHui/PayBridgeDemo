import nextEnv from "@next/env";
import { validateCredentials } from "../lib/config/credentials";
import { AppError } from "../lib/errors/app-error";

// 正式服务启动前检查配置，错误只显示字段说明，不输出 cause 或环境值。
nextEnv.loadEnvConfig(process.cwd());

// 正式服务启动前校验当前配置，失败时设置非零退出码阻止继续启动。
try {
  validateCredentials(process.env);
} catch (error) {
  console.error(error instanceof AppError ? error.message : "环境检查失败，请检查本地配置");
  process.exitCode = 1;
}

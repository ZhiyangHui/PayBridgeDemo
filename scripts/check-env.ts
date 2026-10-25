import nextEnv from "@next/env";
import { validateCredentials } from "../src/server/config/credentials";
import { AppError } from "../src/server/errors/app-error";

// 正式服务启动前检查配置，错误只显示字段说明，不输出 cause 或环境值。
nextEnv.loadEnvConfig(process.cwd());
try {
  validateCredentials(process.env);
} catch (error) {
  console.error(error instanceof AppError ? error.message : "环境检查失败，请检查本地配置");
  process.exitCode = 1;
}

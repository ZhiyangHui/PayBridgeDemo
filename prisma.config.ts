import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
import { defineConfig } from "prisma/config";
import { databaseUrl } from "./src/server/db/url";

loadEnvConfig(process.cwd());
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl(process.env.DATABASE_URL ?? "file:./dev.db") },
});

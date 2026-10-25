import path from "node:path";
export function databaseUrl(value: string) {
  if (!value.startsWith("file:")) throw new Error("仅支持 SQLite file: 地址");
  return `file:${path.resolve(/* turbopackIgnore: true */ process.cwd(), value.slice(5))}`;
}

import { AppError } from "../errors/app-error";

/** 用字符串转换金额，最多两位小数，避免浮点金额进入数据库。 */
export function parseMoney(value: string): number {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) {
    throw new AppError("INVALID_AMOUNT");
  }

  const [yuan, decimal = ""] = value.split(".");
  const fen = Number(yuan) * 100 + Number(decimal.padEnd(2, "0"));

  if (fen > 100_000_000) {
    throw new AppError("INVALID_AMOUNT");
  }

  return fen;
}

/** 金额只在展示时转换为元。 */
export function formatMoney(fen: number): string {
  return (fen / 100).toFixed(2);
}

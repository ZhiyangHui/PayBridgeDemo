import { AppError } from "../errors/app-error";

/**
 * 将元金额字符串转换为整数分。
 * 接受 0 到 1000000 元及最多两位小数，不接受负数、科学计数法或多余字符。
 * @throws AppError 格式错误或超出范围时抛出 INVALID_AMOUNT。
 */
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

/**
 * 把以分为单位的数值转换成保留两位小数的元金额字符串。
 * 例如 1 分返回 0.01；这里只负责展示格式，不执行金额合法性校验。
 */
export function formatMoney(fen: number): string {
  return (fen / 100).toFixed(2);
}

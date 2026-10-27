import { AppError } from "../errors/app-error";

/** 测试商品目录；价格以分保存，只能由服务端决定。 */
export const TEST_PRODUCTS = [
  { id: "test-item", name: "测试商品", amountFen: 1 },
  { id: "test-sticker", name: "测试贴纸", amountFen: 10 },
  { id: "test-notebook", name: "测试笔记本", amountFen: 100 },
  { id: "test-mug", name: "测试马克杯", amountFen: 500 },
] as const;

/** 根据商品编号读取名称和价格，未知商品不允许下单。 */
export function findProduct(id: string = "test-item") {
  const product = TEST_PRODUCTS.find((item) => item.id === id);

  if (!product) {
    throw new AppError("INVALID_INPUT", "商品不存在，请重新选择");
  }

  return product;
}

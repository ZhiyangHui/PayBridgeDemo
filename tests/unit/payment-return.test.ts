import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { paymentReturn as GET } from "../../lib/payments/return";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/config/env", () => ({ getEnv: () => ({ APP_URL: "http://localhost:3000" }) }));

afterEach(() => vi.restoreAllMocks());

describe("支付宝返回商户", () => {
  it("公网返回入口跳回本站订单，丢弃支付宝附带参数", async () => {
    const response = await GET(
      new NextRequest(
        "https://tunnel.test/api/pay/alipay/return?order=order_123&trade_status=TRADE_SUCCESS&total_amount=999&sign=test",
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/orders/order_123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["", "//other.test", "../dashboard", "a?paid=true", "a".repeat(129)])(
    "无效订单参数 %s 只返回订单列表",
    async (order) => {
      const url = new URL("https://tunnel.test/api/pay/alipay/return");
      url.searchParams.set("order", order);
      const response = await GET(new NextRequest(url));
      expect(response.headers.get("location")).toBe("http://localhost:3000/orders");
    },
  );
});

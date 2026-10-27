import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";

vi.mock("server-only", () => ({}));
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createSandboxOrder, settleSandboxPayment } from "../../lib/orders/sandbox";
import { registerMockAccount } from "../../lib/auth/mock-accounts";
import { createMockOrder, ownOrder } from "../../lib/orders/service";
import {
  alipayCheckoutUrl,
  handleAlipayNotification,
  refreshAlipayOrder,
  type AlipayPaymentConfig,
} from "../../lib/payments/alipay";
import { alipaySigningText } from "../../lib/payments/notification";

// 测试使用独立临时数据库和临时密钥，不读取本地开发账号的数据。
const directory = mkdtempSync(path.join(tmpdir(), "paybridge-alipay-"));
const database = `file:${path.join(directory, "test.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: database }) });
const appKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: AlipayPaymentConfig = {
  appId: "9021000000000001",
  merchantId: "2088000000000001",
  privateKey: appKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKey: platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  gateway: "",
  notifyUrl: "https://example.test/api/pay/alipay/notify",
  returnUrl: "https://example.test/orders",
};
let server: Server;
let userId: string;
let queryData: Record<string, unknown>;
let queryCalls: number;
let corruptSignature: boolean;
let httpStatus: number;

beforeAll(async () => {
  writeFileSync(path.join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: database },
    stdio: "pipe",
  });
  // 启动本地网关，检查 SDK 请求签名并返回可控制的查单结果。
  server = createServer(async (request, response) => {
    let body = "";

    for await (const chunk of request) {
      body += chunk;
    }

    const params = new URL(request.url!, "http://localhost").searchParams;
    new URLSearchParams(body).forEach((value, key) => params.set(key, value));
    queryCalls++;
    // 排除签名字段并按参数名排序，重建支付宝请求的待验签内容。
    const text = [...params.entries()]
      .filter(([key]) => key !== "sign")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    const valid = verify(
      "RSA-SHA256",
      Buffer.from(text),
      appKeys.publicKey,
      Buffer.from(params.get("sign") ?? "", "base64"),
    );
    response.statusCode = valid ? httpStatus : 400;
    // 默认用平台私钥签名；错误签名场景改用应用私钥，验证客户端会拒绝响应。
    response.end(
      JSON.stringify({
        alipay_trade_query_response: queryData,
        sign: sign(
          "RSA-SHA256",
          Buffer.from(JSON.stringify(queryData)),
          corruptSignature ? appKeys.privateKey : platformKeys.privateKey,
        ).toString("base64"),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("本地测试网关未启动");
  }

  config.gateway = `http://127.0.0.1:${address.port}/gateway.do`;
}, 30_000);

beforeEach(async () => {
  queryCalls = 0;
  corruptSignature = false;
  httpStatus = 200;
  queryData = { code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  // 按外键依赖顺序清理记录，确保每个测试从空数据库开始。
  await db.paymentNotification.deleteMany();
  await db.order.deleteMany();
  await db.user.deleteMany();
  const profile = await registerMockAccount(db, "alipay", "buyer", "password123", "10.00");
  userId = (await db.mockAccount.findUniqueOrThrow({ where: { id: profile.providerUserId } }))
    .userId;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  // 关闭本地网关和数据库连接，再删除本轮测试的临时文件。
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

/**
 * 生成带有效 RSA 签名的支付宝支付通知请求。
 * @param order 通知对应的商户订单号。
 * @param fields 覆盖默认通知字段，用于测试金额、商户或状态不匹配的情况。
 */
function notification(order: { outTradeNo: string }, fields: Record<string, string> = {}) {
  const data: Record<string, string> = {
    app_id: config.appId,
    seller_id: config.merchantId,
    out_trade_no: order.outTradeNo,
    trade_no: `trade_${order.outTradeNo}`,
    total_amount: "0.01",
    trade_status: "TRADE_SUCCESS",
    notify_id: `notify_${order.outTradeNo}`,
    sign_type: "RSA2",
    ...fields,
  };
  data.sign = sign(
    "RSA-SHA256",
    Buffer.from(alipaySigningText(data)),
    platformKeys.privateKey,
  ).toString("base64");

  return new Request(config.notifyUrl, { method: "POST", body: new URLSearchParams(data) });
}

/**
 * 为当前测试用户创建一笔待付款的支付宝沙箱订单。
 * 每次生成新的提交键，避免不同测试订单被当作重复提交。
 */
function order() {
  return createSandboxOrder(db, userId, randomUUID(), config);
}

/**
 * 构造指定订单已支付的支付宝查单响应数据。
 * 签名由本地测试网关生成，本函数只返回业务字段。
 */
function paidQuery(outTradeNo: string) {
  return {
    code: "10000",
    out_trade_no: outTradeNo,
    trade_no: `trade_${outTradeNo}`,
    total_amount: "0.01",
    trade_status: "TRADE_SUCCESS",
    seller_id: config.merchantId,
  };
}

describe("支付宝沙箱支付", () => {
  it("先固定订单金额，再生成签名正确的官方 PC 收银台请求", async () => {
    const saved = await order();
    const url = new URL(alipayCheckoutUrl(saved, config));
    const params = url.searchParams;
    expect(params.get("method")).toBe("alipay.trade.page.pay");
    expect(params.get("notify_url")).toBe(config.notifyUrl);
    expect(new URL(params.get("return_url")!).searchParams.get("order")).toBe(saved.id);
    expect(JSON.parse(params.get("biz_content")!)).toMatchObject({
      out_trade_no: saved.outTradeNo,
      total_amount: "0.01",
      product_code: "FAST_INSTANT_TRADE_PAY",
    });
    const content = [...params.entries()]
      .filter(([key]) => key !== "sign")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(content),
        appKeys.publicKey,
        Buffer.from(params.get("sign")!, "base64"),
      ),
    ).toBe(true);
    expect((await ownOrder(db, userId, saved.id)).status).toBe("pending");
  });

  it("重复下单幂等，别人的提交键和订单不可复用", async () => {
    const key = randomUUID();
    const first = await createSandboxOrder(db, userId, key, config);
    expect((await createSandboxOrder(db, userId, key, config)).id).toBe(first.id);
    const other = await db.user.create({ data: { nickname: "other" } });
    await expect(createSandboxOrder(db, other.id, key, config)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(ownOrder(db, other.id, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("真实签名通知入账，重复处理不重复记账，也不扣本站模拟余额", async () => {
    const saved = await order();
    expect(await (await handleAlipayNotification(db, notification(saved), config)).text()).toBe(
      "success",
    );
    await handleAlipayNotification(db, notification(saved), config);
    expect((await ownOrder(db, userId, saved.id)).status).toBe("paid");
    expect(await db.paymentNotification.count()).toBe(1);
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId } })).balanceFen).toBe(1000);
  });

  it.each<Record<string, string>>([
    { total_amount: "0.02" },
    { seller_id: "wrong" },
    { app_id: "wrong" },
    { out_trade_no: "unknown" },
  ])("拒绝签名正确但业务字段错误的通知：%j", async (fields) => {
    const saved = await order();
    await expect(
      handleAlipayNotification(db, notification(saved, fields), config),
    ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
    expect((await ownOrder(db, userId, saved.id)).status).toBe("pending");
  });

  it("拒绝被篡改的签名和重复通知参数", async () => {
    const saved = await order();
    const raw = await notification(saved).text();

    for (const body of [
      raw.replace("total_amount=0.01", "total_amount=0.02"),
      raw + "&total_amount=0.01",
    ]) {
      await expect(
        handleAlipayNotification(
          db,
          new Request(config.notifyUrl, { method: "POST", body }),
          config,
        ),
      ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
    }
  });

  it("模拟订单不能被沙箱通知或查单入账", async () => {
    const mock = await createMockOrder(db, userId, "alipay", randomUUID());
    await expect(handleAlipayNotification(db, notification(mock), config)).rejects.toMatchObject({
      code: "PAYMENT_INVALID",
    });
    expect(() => alipayCheckoutUrl(mock, config)).toThrow();
  });

  it("关闭通知只关闭待付款订单，已支付订单不回退", async () => {
    const closed = await order();
    await handleAlipayNotification(
      db,
      notification(closed, { trade_status: "TRADE_CLOSED" }),
      config,
    );
    expect((await ownOrder(db, userId, closed.id)).status).toBe("closed");
    const paid = await order();
    await handleAlipayNotification(db, notification(paid), config);
    await handleAlipayNotification(
      db,
      notification(paid, { trade_status: "TRADE_CLOSED" }),
      config,
    );
    expect((await ownOrder(db, userId, paid.id)).status).toBe("paid");
  });

  it("漏通知时通过验签查单补回付款，后续通知保持幂等", async () => {
    const saved = await order();
    queryData = paidQuery(saved.outTradeNo);
    expect((await refreshAlipayOrder(db, saved, config)).status).toBe("paid");
    await handleAlipayNotification(db, notification(saved), config);
    expect(await db.paymentNotification.count()).toBe(1);
  });

  it("交易不存在时保持待付款，连续轮询只查一次平台", async () => {
    const saved = await order();
    const results = await Promise.all([
      refreshAlipayOrder(db, saved, config),
      refreshAlipayOrder(db, saved, config),
    ]);
    expect(results.every((result) => result.status === "pending")).toBe(true);
    expect(queryCalls).toBe(1);
  });

  it.each(["signature", "amount", "order", "http", "business"])(
    "查单 %s 异常不改变付款状态",
    async (kind) => {
      const saved = await order();
      queryData = paidQuery(saved.outTradeNo);
      corruptSignature = kind === "signature";
      httpStatus = kind === "http" ? 500 : 200;

      if (kind === "amount") {
        queryData.total_amount = "1.00";
      }

      if (kind === "order") {
        queryData.out_trade_no = "other";
      }

      if (kind === "business") {
        queryData = { code: "20000", sub_code: "ACQ.SYSTEM_ERROR" };
      }

      await expect(refreshAlipayOrder(db, saved, config)).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_ERROR",
      });
      expect((await ownOrder(db, userId, saved.id)).status).toBe("pending");
    },
  );

  it("收款配置变更后不能继续处理旧订单", async () => {
    const saved = await order();
    expect(() => alipayCheckoutUrl(saved, { ...config, appId: "other" })).toThrow();
    await expect(
      settleSandboxPayment(
        db,
        {
          provider: "alipay",
          outTradeNo: saved.outTradeNo,
          tradeNo: "t",
          amountFen: 1,
          currency: "CNY",
          dedupeKey: "n",
        },
        { ...config, merchantId: "other" },
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
  });
});

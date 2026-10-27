import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { registerMockAccount, loginMockAccount } from "../../src/server/auth/mock-accounts";
import {
  createMockOrder,
  ownOrder,
  setMockBalance,
  cancelMockOrder,
} from "../../src/server/orders/service";
import { mockPaymentNotification } from "../../src/server/payments/mock-provider";
import { handleMockNotification } from "../../src/server/payments/handler";
import { parseMoney } from "../../src/server/orders/money";
import type { Order } from "../../src/generated/prisma/client";

// 每轮测试使用独立数据库和密钥，避免修改开发环境的账号与余额。
const directory = mkdtempSync(path.join(tmpdir(), "paybridge-shop-"));
const database = `file:${path.join(directory, "test.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: database }) });
const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const keys = {
  ...pair,
  apiV3Key: randomBytes(32),
  appId: "paybridge_mock",
  merchantId: "mock_merchant",
  serial: "TEST",
};

beforeAll(() => {
  writeFileSync(path.join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: database },
    stdio: "pipe",
  });
}, 30_000);

// 每个用例开始前清空订单、通知和账号，防止前一个用例影响结果。
beforeEach(async () => {
  await db.paymentNotification.deleteMany();
  await db.order.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

/**
 * 注册一个模拟测试账号，返回它关联的本站用户 ID。
 * @param balance 初始余额，单位为元。
 * @param provider 账号所属的模拟登录和支付渠道。
 */
async function account(
  username = "alice",
  balance = "1.00",
  provider: "wechat" | "alipay" = "wechat",
) {
  const profile = await registerMockAccount(db, provider, username, "password123", balance);

  return (await db.mockAccount.findUniqueOrThrow({ where: { id: profile.providerUserId } })).userId;
}

/**
 * 生成订单的模拟支付通知，并交给通知处理器验签和结算。
 * @returns 通知处理器的 HTTP 响应，供测试检查付款结果。
 */
async function pay(order: Order) {
  return handleMockNotification(
    db,
    new Request("http://localhost/notify", {
      method: "POST",
      ...mockPaymentNotification(order, keys),
    }),
    order.provider,
    keys,
  );
}

describe("注册、余额与模拟支付", () => {
  it("注册保存加盐哈希，账号大小写归一，只有正确密码可登录", async () => {
    await account("Alice");
    const row = await db.mockAccount.findFirstOrThrow();
    expect(row.passwordHash).not.toContain("password123");
    expect(row.balanceFen).toBe(100);
    expect((await loginMockAccount(db, "wechat", "ALICE", "password123")).providerUserId).toBe(
      row.id,
    );
    await expect(loginMockAccount(db, "wechat", "alice", "wrong-password")).rejects.toMatchObject({
      code: "LOGIN_FAILED",
    });
    await expect(loginMockAccount(db, "alipay", "alice", "password123")).rejects.toMatchObject({
      code: "LOGIN_FAILED",
    });
    await expect(account("alice")).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(await db.user.count()).toBe(1);
  });

  it("余额按分保存，拒绝负数、超额、三位小数和弱密码", async () => {
    expect(parseMoney("0.01")).toBe(1);
    const user = await account();
    await setMockBalance(db, user, "12.34");
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
      1234,
    );

    for (const amount of ["-1", "1.001", "1000001", "NaN", "1e3"]) {
      await expect(setMockBalance(db, user, amount)).rejects.toMatchObject({
        code: "INVALID_AMOUNT",
      });
    }

    await expect(registerMockAccount(db, "wechat", "bob", "123", "1")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("下单只用服务端金额，重复提交复用订单，禁止跨用户读取", async () => {
    const user = await account();
    const other = await account("bob");
    const key = randomUUID();
    const order = await createMockOrder(db, user, "wechat", key);
    expect(order.status).toBe("pending");
    expect(order.amountFen).toBe(1);
    expect((await createMockOrder(db, user, "wechat", key)).id).toBe(order.id);
    await expect(createMockOrder(db, other, "wechat", key)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(ownOrder(db, other, order.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  for (const provider of ["wechat", "alipay"] as const) {
    it(`${provider} 通过签名通知扣款，重复通知只扣一次且返回平台确认`, async () => {
      const user = await account("alice", "1.00", provider);
      const order = await createMockOrder(db, user, provider, randomUUID());
      const response = await pay(order);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(provider === "alipay" ? "success" : "SUCCESS");
      await pay(order);
      expect((await ownOrder(db, user, order.id)).status).toBe("paid");
      expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
        99,
      );
      expect(await db.paymentNotification.count()).toBe(1);
      await expect(cancelMockOrder(db, user, order.id)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it(`${provider} 拒绝篡改通知和金额、错误商户，保持余额与订单不变`, async () => {
      const user = await account("alice", "1.00", provider);
      const order = await createMockOrder(db, user, provider, randomUUID());
      const notification = mockPaymentNotification(order, keys);
      await expect(
        handleMockNotification(
          db,
          new Request("http://localhost/notify", {
            method: "POST",
            ...notification,
            body: notification.body + "tampered",
          }),
          provider,
          keys,
        ),
      ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
      await expect(pay({ ...order, amountFen: 2 })).rejects.toMatchObject({
        code: "PAYMENT_INVALID",
      });
      const foreign = mockPaymentNotification(order, { ...keys, merchantId: "other" });
      await expect(
        handleMockNotification(
          db,
          new Request("http://localhost/notify", { method: "POST", ...foreign }),
          provider,
          keys,
        ),
      ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
      expect((await ownOrder(db, user, order.id)).status).toBe("pending");
      expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
        100,
      );
      expect(await db.paymentNotification.count()).toBe(0);
    });
  }

  it("余额不足回滚订单，补余额后可以重试，取消订单不扣钱", async () => {
    const user = await account("alice", "0");
    const order = await createMockOrder(db, user, "wechat", randomUUID());
    await expect(pay(order)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await ownOrder(db, user, order.id)).status).toBe("pending");
    expect(await db.paymentNotification.count()).toBe(0);
    await setMockBalance(db, user, "0.01");
    await pay(order);
    const cancelled = await createMockOrder(db, user, "wechat", randomUUID());
    await cancelMockOrder(db, user, cancelled.id);
    await expect(pay(cancelled)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
      0,
    );
  });

  it.each(["wechat", "alipay"] as const)("%s 账号不能通过另一个渠道下单", async (provider) => {
    const user = await account("alice", "1.00", provider);
    const other = provider === "wechat" ? "alipay" : "wechat";
    await expect(createMockOrder(db, user, other, randomUUID())).rejects.toMatchObject({
      code: "PAYMENT_CHANNEL_MISMATCH",
    });
    expect(await db.order.count()).toBe(0);
  });

  it("旧的跨渠道待付款订单收到签名通知也不能扣款", async () => {
    const user = await account();
    const order = await db.order.create({
      data: {
        userId: user,
        provider: "alipay",
        mode: "mock",
        outTradeNo: randomUUID(),
        amountFen: 1,
      },
    });
    await expect(pay(order)).rejects.toMatchObject({ code: "PAYMENT_CHANNEL_MISMATCH" });
    expect((await ownOrder(db, user, order.id)).status).toBe("pending");
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
      100,
    );
    expect(await db.paymentNotification.count()).toBe(0);
    await cancelMockOrder(db, user, order.id);
    expect((await ownOrder(db, user, order.id)).status).toBe("closed");
  });

  it("两个并发订单不能透支同一个钱包", async () => {
    const user = await account("alice", "0.01");
    const first = await createMockOrder(db, user, "wechat", randomUUID());
    const second = await createMockOrder(db, user, "wechat", randomUUID());
    const results = await Promise.allSettled([pay(first), pay(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.order.count({ where: { status: "paid" } })).toBe(1);
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId: user } })).balanceFen).toBe(
      0,
    );
  });
});

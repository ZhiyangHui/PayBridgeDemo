import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { registerMockAccount } from "../../lib/auth/mock-accounts";
import { startLogin, confirmMockLogin, finishLogin } from "../../lib/auth/routes";
import { createMockOrder } from "../../lib/orders/service";
import { createSandboxOrder } from "../../lib/orders/sandbox";
import { completeLogin, readSession } from "../../lib/auth/store";
import {
  createPayment,
  receiveNotification,
  simulatePayment,
  updateBalance,
} from "../../lib/payments/routes";
import { getMockPaymentKeys } from "../../lib/payments/mock-keys";
import { mockPaymentNotification } from "../../lib/payments/mock-provider";

// 仅替换 Cookie 入口和数据库连接，订单、会话、模式判断与通知处理使用真实代码。
const browser = vi.hoisted(() => ({ token: "", keyFile: "" }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/db", () => ({ getDb: () => db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: browser.token }) }),
}));

// 模拟密钥文件放在测试内存中，避免读取或覆盖开发环境的密钥。
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const keyPath = ".local/mock-payment-keys.json";

  return {
    ...fs,
    existsSync: (file: Parameters<typeof fs.existsSync>[0]) =>
      file === keyPath ? Boolean(browser.keyFile) : fs.existsSync(file),
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) =>
      args[0] === ".local" ? undefined : fs.mkdirSync(...args),
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) =>
      args[0] === keyPath ? browser.keyFile : fs.readFileSync(...args),
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (args[0] === keyPath) {
        browser.keyFile = String(args[1]);
      } else {
        fs.writeFileSync(...args);
      }
    },
  };
});

const directory = mkdtempSync(path.join(tmpdir(), "paybridge-wechat-routes-"));
const database = `file:${path.join(directory, "test.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: database }) });
const origin = "http://localhost:3000";
let userId: string;

beforeAll(() => {
  writeFileSync(path.join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: database },
    stdio: "pipe",
  });
}, 30_000);

beforeEach(async () => {
  // 支付宝配置仅用于通过环境校验，本组测试不向支付宝发送请求。
  const env = {
    APP_URL: origin,
    DATABASE_URL: database,
    SESSION_SECRET: "test-session-secret-".repeat(3),
    PAYMENT_MODE: "sandbox",
    WECHAT_MODE: "mock",
    ALIPAY_LOGIN_MODE: "mock",
    ALIPAY_APP_ID: "9021000000000001",
    ALIPAY_SELLER_ID: "2088000000000001",
    ALIPAY_PRIVATE_KEY: "unused-test-key",
    ALIPAY_PUBLIC_KEY: "unused-test-key",
    ALIPAY_GATEWAY: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    ALIPAY_NOTIFY_URL: "https://example.test/notify",
    ALIPAY_RETURN_URL: "https://example.test/orders",
  };

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.paymentNotification.deleteMany();
  await db.order.deleteMany();
  await db.user.deleteMany();
  const profile = await registerMockAccount(db, "wechat", "buyer", "password123", "1.00");
  browser.token = await completeLogin(db, "wechat", profile);
  userId = (await db.mockAccount.findUniqueOrThrow({ where: { id: profile.providerUserId } }))
    .userId;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

/** 构造本站表单请求，默认带上用于同源校验的 Origin。 */
function form(url: string, fields: Record<string, string>, source = origin) {
  return new NextRequest(new URL(url, origin), {
    method: "POST",
    headers: { origin: source },
    body: new URLSearchParams({ paymentMode: "mock", ...fields }),
  });
}

/** 调用微信下单入口，读取跳转地址对应的数据库订单。 */
async function createOrder() {
  const response = await createPayment(
    form("/api/pay/wechat/create", { checkoutKey: randomUUID(), amount: "999", status: "paid" }),
    "wechat",
  );
  expect(response.status).toBe(303);
  const url = new URL(response.headers.get("location")!);
  expect(url.pathname).toMatch(/^\/orders\//);

  return db.order.findUniqueOrThrow({ where: { id: url.pathname.split("/").at(-1)! } });
}

/** 提交模拟付款或取消表单，返回重定向中的错误码。 */
async function act(id: string, action = "pay") {
  const response = await simulatePayment(form(`/api/mock/pay/${id}`, { action }), id);
  expect(response.status).toBe(303);

  return new URL(response.headers.get("location")!).searchParams.get("error");
}

/** 从实际登录入口走到回调，验证入口选择不会被表单里的模式覆盖。 */
async function enterAlipay(sandbox: boolean, intent = "register") {
  const path = sandbox ? "/api/auth/alipay/sandbox/start" : "/api/auth/alipay/start";
  const response = await startLogin(
    new NextRequest(origin + path, { headers: { host: "localhost:3000" } }),
    "alipay",
    sandbox,
  );
  const target = new URL(response.headers.get("location")!);
  expect(target.origin).toBe(origin);
  expect(target.pathname).toBe("/mock/login/alipay");
  const browserCookie = response.cookies.get("oauth_alipay")!.value;
  const auth = new NextRequest(origin + "/api/mock/auth/alipay", {
    method: "POST",
    headers: { origin, cookie: `oauth_alipay=${browserCookie}` },
    body: new URLSearchParams({
      state: target.searchParams.get("state")!,
      intent,
      username: "entry_buyer",
      password: "password123",
      balance: "1.00",
      paymentMode: sandbox ? "mock" : "sandbox",
    }),
  });
  const confirmed = await confirmMockLogin(auth, "alipay");
  const callback = new URL(confirmed.headers.get("location")!);
  callback.searchParams.set("paymentMode", sandbox ? "mock" : "sandbox");
  const finished = await finishLogin(
    new NextRequest(callback, {
      headers: { cookie: `oauth_alipay=${browserCookie}; paybridge_session=${browser.token}` },
    }),
    "alipay",
  );
  expect(new URL(finished.headers.get("location")!).pathname).toBe("/dashboard");
  browser.token = finished.cookies.get("paybridge_session")!.value;

  return (await readSession(db, browser.token))!;
}

describe("支付宝模拟与沙箱隔离", () => {
  it("两个入口都用本站账号，但会话分别保存 mock 和 sandbox，不接受回调覆盖", async () => {
    const mock = await enterAlipay(false);
    expect(mock.paymentMode).toBe("mock");
    const sandbox = await enterAlipay(true, "login");
    expect(sandbox.paymentMode).toBe("sandbox");
    expect(sandbox.user.id).toBe(mock.user.id);
  });

  it("实际模拟入口下单不使用支付宝 SDK，也不访问外网", async () => {
    await enterAlipay(false);
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止外网请求"));
    const response = await createPayment(
      form("/api/pay/alipay/create", { checkoutKey: randomUUID() }),
      "alipay",
    );
    expect(new URL(response.headers.get("location")!).pathname).toMatch(/^\/orders\//);
    expect((await db.order.findFirstOrThrow()).mode).toBe("mock");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("只有沙箱入口生成支付宝沙箱收银台地址，且不扣模拟余额", async () => {
    const keys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    vi.stubEnv("ALIPAY_PRIVATE_KEY", keys.privateKey);
    vi.stubEnv("ALIPAY_PUBLIC_KEY", keys.publicKey);
    const session = await enterAlipay(true);
    const response = await createPayment(
      form("/api/pay/alipay/create", { checkoutKey: randomUUID(), paymentMode: "sandbox" }),
      "alipay",
    );
    expect(new URL(response.headers.get("location")!).hostname).toBe(
      "openapi-sandbox.dl.alipaydev.com",
    );
    expect((await db.order.findFirstOrThrow()).mode).toBe("sandbox");
    expect(
      (await db.mockAccount.findUniqueOrThrow({ where: { userId: session.user.id } })).balanceFen,
    ).toBe(100);
  });

  it("模拟会话不能伪造模式或继续支付本人沙箱订单", async () => {
    const session = await enterAlipay(false);
    const saved = await createSandboxOrder(db, session.user.id, randomUUID(), {
      appId: "test",
      merchantId: "test",
    });

    const submissions: Record<string, string>[] = [
      { checkoutKey: randomUUID(), paymentMode: "sandbox" },
      { orderId: saved.id },
    ];

    for (const fields of submissions) {
      const response = await createPayment(form("/api/pay/alipay/create", fields), "alipay");
      expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe(
        "PAYMENT_MODE_MISMATCH",
      );
    }

    expect(await db.order.count()).toBe(1);
  });

  it("切换到沙箱入口后，旧模拟付款表单和旧模拟订单不能发起沙箱付款", async () => {
    const session = await enterAlipay(false);
    const saved = await createMockOrder(db, session.user.id, "alipay", randomUUID());
    await enterAlipay(true, "login");

    const submissions: Record<string, string>[] = [
      { checkoutKey: randomUUID(), paymentMode: "mock" },
      { orderId: saved.id, paymentMode: "sandbox" },
    ];

    for (const fields of submissions) {
      const response = await createPayment(form("/api/pay/alipay/create", fields), "alipay");
      expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe(
        "PAYMENT_MODE_MISMATCH",
      );
    }
  });

  it("模拟通知可以与沙箱并存，但绝不能结算沙箱订单", async () => {
    const session = await enterAlipay(false);
    const mock = await createMockOrder(db, session.user.id, "alipay", randomUUID());
    const sandbox = await createSandboxOrder(db, session.user.id, randomUUID(), {
      appId: "test",
      merchantId: "test",
    });
    const keys = getMockPaymentKeys("alipay", "mock");

    for (const order of [mock, sandbox]) {
      const payload = mockPaymentNotification(order, keys);
      const response = await receiveNotification(
        new NextRequest(origin + "/api/pay/alipay/notify", { method: "POST", ...payload }),
        "alipay",
      );
      expect(response.status).toBe(order.mode === "mock" ? 200 : 400);
    }

    expect((await db.order.findUniqueOrThrow({ where: { id: sandbox.id } })).status).toBe(
      "pending",
    );
    expect(
      (await db.mockAccount.findUniqueOrThrow({ where: { userId: session.user.id } })).balanceFen,
    ).toBe(99);
  });

  it("全局开启沙箱时，模拟登录仍创建模拟订单并只扣本站余额", async () => {
    const profile = await registerMockAccount(db, "alipay", "alipay_mock", "password123", "1.00");
    browser.token = await completeLogin(db, "alipay", profile);
    const response = await createPayment(
      form("/api/pay/alipay/create", { checkoutKey: randomUUID() }),
      "alipay",
    );
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toMatch(/^\/orders\//);
    const order = await db.order.findUniqueOrThrow({
      where: { id: target.pathname.split("/").at(-1)! },
    });
    expect(order.mode).toBe("mock");
    expect(await act(order.id)).toBeNull();
    expect(
      (await db.mockAccount.findUniqueOrThrow({ where: { id: profile.providerUserId } }))
        .balanceFen,
    ).toBe(99);
  });
});

describe("微信模拟支付接口", () => {
  it("下单入口采用商品编号对应价格，不信任浏览器金额和名称", async () => {
    const response = await createPayment(
      form("/api/pay/wechat/create", {
        checkoutKey: randomUUID(),
        productId: "test-notebook",
        amount: "0.01",
        productName: "篡改商品名",
      }),
      "wechat",
    );
    expect(response.headers.get("location")).toContain("/orders/");
    const saved = await db.order.findFirstOrThrow();
    expect(saved).toMatchObject({
      productId: "test-notebook",
      productName: "测试笔记本",
      amountFen: 100,
    });
    expect(await act(saved.id)).toBeNull();
    expect((await db.mockAccount.findUniqueOrThrow({ where: { userId } })).balanceFen).toBe(0);
  });

  it.each(["sandbox", "mock"])("支付宝为 %s 时，微信付款成功且重复付款只扣一次", async (mode) => {
    vi.stubEnv("PAYMENT_MODE", mode);
    const order = await createOrder();
    expect(order).toMatchObject({
      provider: "wechat",
      mode: "mock",
      status: "pending",
      amountFen: 1,
    });
    expect(await act(order.id)).toBeNull();
    expect(await act(order.id)).toBeNull();
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "paid",
    });
    expect(await db.mockAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      balanceFen: 99,
    });
    expect(await db.paymentNotification.count()).toBe(1);
  });

  it("微信通知入口在支付宝沙箱模式下也能验签、解密和去重", async () => {
    const order = await createOrder();
    const payload = mockPaymentNotification(order, getMockPaymentKeys("wechat"));

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await receiveNotification(
        new NextRequest(`${origin}/api/pay/wechat/notify`, {
          method: "POST",
          ...payload,
        }),
        "wechat",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ code: "SUCCESS" });
    }

    expect(await db.mockAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      balanceFen: 99,
    });
    expect(await db.paymentNotification.count()).toBe(1);
  });

  it("支付宝沙箱渠道不能使用模拟密钥", () => {
    expect(() => getMockPaymentKeys("alipay")).toThrowError("此操作仅支持模拟模式");
  });

  it("篡改微信通知、金额或商户后，通知入口拒绝记账", async () => {
    const order = await createOrder();
    const keys = getMockPaymentKeys("wechat");
    const valid = mockPaymentNotification(order, keys);
    const payloads = [
      { ...valid, body: valid.body + "tampered" },
      mockPaymentNotification({ ...order, amountFen: 2 }, keys),
      mockPaymentNotification(order, { ...keys, merchantId: "other" }),
    ];

    for (const payload of payloads) {
      const response = await receiveNotification(
        new NextRequest(`${origin}/api/pay/wechat/notify`, {
          method: "POST",
          ...payload,
        }),
        "wechat",
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "FAIL" });
    }

    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "pending",
    });
    expect(await db.mockAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      balanceFen: 100,
    });
    expect(await db.paymentNotification.count()).toBe(0);
  });

  it("余额不足保留待付款，补足余额后可付款", async () => {
    await updateBalance(form("/api/mock/wallet", { balance: "0" }));
    const order = await createOrder();
    expect(await act(order.id)).toBe("INSUFFICIENT_BALANCE");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "pending",
    });
    expect(await db.paymentNotification.count()).toBe(0);
    await updateBalance(form("/api/mock/wallet", { balance: "0.01" }));
    expect(await act(order.id)).toBeNull();
    expect(await db.mockAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      balanceFen: 0,
    });
  });

  it("取消订单不扣款，取消后付款被拒绝", async () => {
    const order = await createOrder();
    expect(await act(order.id, "cancel")).toBeNull();
    expect(await act(order.id)).toBe("CONFLICT");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "closed",
    });
    expect(await db.mockAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      balanceFen: 100,
    });
  });

  it("拦截未登录、跨用户、跨渠道和外站付款请求", async () => {
    const order = await createOrder();
    browser.token = "";
    expect(await act(order.id)).toBe("UNAUTHENTICATED");
    const other = await registerMockAccount(db, "wechat", "other", "password123", "1.00");
    browser.token = await completeLogin(db, "wechat", other);
    expect(await act(order.id)).toBe("NOT_FOUND");
    const response = await createPayment(
      form("/api/pay/alipay/create", { checkoutKey: randomUUID() }),
      "alipay",
    );
    expect(response.headers.get("location")).toContain("PAYMENT_CHANNEL_MISMATCH");
    const foreign = await simulatePayment(
      form(`/api/mock/pay/${order.id}`, { action: "pay" }, "https://other.test"),
      order.id,
    );
    expect(foreign.headers.get("location")).toContain("FORBIDDEN");
    expect(await db.paymentNotification.count()).toBe(0);
  });
});

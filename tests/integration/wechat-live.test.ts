import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCipheriv, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const boundaries = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));
vi.mock("../../src/server/db/client", () => ({ getDb: () => boundaries.db }));
vi.mock("../../src/server/auth/session", async (original) => ({
  ...(await original<object>()),
  currentSession: async () => boundaries.session,
}));
import { PrismaClient, type Order } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createRemoteOrder } from "../../src/server/orders/remote";
import {
  createWechatPayment,
  handleWechatNotification,
  refreshWechatOrder,
} from "../../src/server/payments/wechat";
import {
  wechatPayRequest,
  type WechatPaymentConfig,
} from "../../src/server/payments/wechat-client";
import { z } from "zod";
import { createPayment, receiveNotification } from "../../src/server/payments/routes";
import { startLogin, finishLogin } from "../../src/server/auth/routes";
import { createLoginState, readSession } from "../../src/server/auth/store";

const directory = mkdtempSync(path.join(tmpdir(), "paybridge-wechat-live-"));
const database = `file:${path.join(directory, "test.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: database }) });
const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: WechatPaymentConfig = {
  appId: "wx1234567890abcdef",
  merchantId: "1900000001",
  apiV3Key: Buffer.from("a".repeat(32)),
  certificateSerial: "AB".repeat(20),
  serial: "PUB_KEY_ID_TEST",
  notifyUrl: "https://shop.test/api/pay/wechat/notify",
  privateKey: merchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKey: platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
};
let userId: string;
let queryData: unknown;
let queryStatus: number;
let corruptSignature: boolean;
let fetcher: ReturnType<typeof vi.fn>;

/** 对原始正文生成平台响应签名，测试不依赖实现中的签名函数。 */
function signedResponse(body: string, status = 200) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "test-response-nonce";
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
    corruptSignature ? merchantKeys.privateKey : platformKeys.privateKey,
  ).toString("base64");

  return new Response(body, {
    status,
    headers: {
      "Wechatpay-Timestamp": timestamp,
      "Wechatpay-Nonce": nonce,
      "Wechatpay-Serial": config.serial,
      "Wechatpay-Signature": signature,
    },
  });
}

/** 独立验证商户请求签名后返回微信格式的测试响应。 */
async function gateway(url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  const fields = Object.fromEntries(
    [...headers.get("Authorization")!.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const target = new URL(url);
  const body = String(init.body ?? "");
  expect(fields.mchid).toBe(config.merchantId);
  expect(fields.serial_no).toBe(config.certificateSerial);
  expect(
    verify(
      "RSA-SHA256",
      Buffer.from(
        `${init.method}\n${target.pathname}${target.search}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`,
      ),
      merchantKeys.publicKey,
      Buffer.from(fields.signature, "base64"),
    ),
  ).toBe(true);

  if (init.method === "POST") {
    const data = JSON.parse(body);
    expect(data.amount).toEqual({ total: 1, currency: "CNY" });
    expect(data.appid).toBe(config.appId);
    expect(data.notify_url).toBe(config.notifyUrl);
    expect(data.out_trade_no).toHaveLength(32);
    expect(await db.order.count({ where: { outTradeNo: data.out_trade_no } })).toBe(1);

    return signedResponse(JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=test" }));
  }

  return signedResponse(JSON.stringify(queryData), queryStatus);
}

beforeAll(() => {
  writeFileSync(path.join(directory, "test.db"), "");
  writeFileSync(path.join(directory, "private.pem"), config.privateKey);
  writeFileSync(path.join(directory, "platform.pem"), config.publicKey);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: database },
    stdio: "pipe",
  });
  boundaries.db = db;
}, 30_000);

beforeEach(async () => {
  // 仅使用临时凭据，不读取或覆盖项目中的 .env.local。
  const env = {
    APP_URL: "https://shop.test",
    DATABASE_URL: database,
    SESSION_SECRET: "s".repeat(32),
    PAYMENT_MODE: "sandbox",
    WECHAT_MODE: "live",
    ALIPAY_LOGIN_MODE: "mock",
    WECHAT_APP_ID: config.appId,
    WECHAT_APP_SECRET: "b".repeat(32),
    WECHAT_PAY_APP_ID: config.appId,
    WECHAT_PAY_MCH_ID: config.merchantId,
    WECHAT_PAY_API_V3_KEY: config.apiV3Key.toString(),
    WECHAT_PAY_CERT_SERIAL_NO: config.certificateSerial,
    WECHAT_PAY_PLATFORM_KEY_ID: config.serial,
    WECHAT_PAY_PRIVATE_KEY_PATH: path.join(directory, "private.pem"),
    WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: path.join(directory, "platform.pem"),
    WECHAT_PAY_NOTIFY_URL: config.notifyUrl,
    ALIPAY_APP_ID: "9021000000000001",
    ALIPAY_SELLER_ID: "2088000000000001",
    ALIPAY_PRIVATE_KEY: "test-key",
    ALIPAY_PUBLIC_KEY: "test-key",
    ALIPAY_GATEWAY: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    ALIPAY_NOTIFY_URL: "https://shop.test/api/pay/alipay/notify",
    ALIPAY_RETURN_URL: "https://shop.test/orders",
  };

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  await db.paymentNotification.deleteMany();
  await db.order.deleteMany();
  await db.session.deleteMany();
  await db.authIdentity.deleteMany();
  await db.user.deleteMany();
  await db.oAuthState.deleteMany();
  userId = (await db.user.create({ data: { nickname: "测试用户" } })).id;
  boundaries.session = { provider: "wechat", user: { id: userId } };
  queryData = { code: "ORDER_NOT_EXIST" };
  queryStatus = 404;
  corruptSignature = false;
  fetcher = vi.fn(gateway);
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

/** 创建一笔微信正式模式订单，用于测试远程支付而非模拟钱包扣款。 */
function order(checkoutKey = randomUUID()) {
  return createRemoteOrder(db, userId, checkoutKey, {
    ...config,
    provider: "wechat",
    mode: "live",
  });
}

/** 生成给定订单的微信交易查询结果，可覆盖金额和商户等字段。 */
function transaction(saved: Order, fields: Record<string, unknown> = {}) {
  return {
    appid: config.appId,
    mchid: config.merchantId,
    out_trade_no: saved.outTradeNo,
    transaction_id: `wx-${saved.id}`,
    trade_type: "NATIVE",
    trade_state: "SUCCESS",
    amount: { total: 1, currency: "CNY" },
    ...fields,
  };
}

/** 用测试平台私钥签名、API v3 密钥加密一份微信成功通知。 */
function notification(saved: Order, fields: Record<string, unknown> = {}) {
  const nonce = "123456789012";
  const cipher = createCipheriv("aes-256-gcm", config.apiV3Key, nonce);
  cipher.setAAD(Buffer.from("transaction"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(transaction(saved, fields))),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const body = JSON.stringify({
    id: `notice-${saved.id}`,
    event_type: "TRANSACTION.SUCCESS",
    resource: {
      algorithm: "AEAD_AES_256_GCM",
      nonce,
      associated_data: "transaction",
      ciphertext: encrypted.toString("base64"),
    },
  });

  return new NextRequest(config.notifyUrl, {
    method: "POST",
    body,
    headers: signedResponse(body).headers,
  });
}

/** 构造同源付款表单；金额字段专门传错误值，确认服务端不会采用。 */
function checkout(data: Record<string, string>) {
  return new NextRequest("https://shop.test/api/pay/wechat/create", {
    method: "POST",
    headers: { origin: "https://shop.test" },
    body: new URLSearchParams({ ...data, amount: "9999" }),
  });
}

describe("微信 Native 正式协议（临时密钥，本地响应）", () => {
  it("下单入口先保存固定金额订单，生成付款码并复用提交键和二维码", async () => {
    const checkoutKey = randomUUID();
    const response = await createPayment(checkout({ checkoutKey }), "wechat");
    const saved = await db.order.findFirstOrThrow();
    expect(response.headers.get("location")).toBe(`https://shop.test/orders/${saved.id}`);
    expect(saved.paymentUrl).toBe("weixin://wxpay/bizpayurl?pr=test");
    expect(saved.status).toBe("pending");
    await createPayment(checkout({ checkoutKey }), "wechat");
    expect(await db.order.count()).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("通知入口验签解密后入账，重复通知只保存一次", async () => {
    const saved = await order();
    expect((await receiveNotification(notification(saved), "wechat")).status).toBe(204);
    expect((await receiveNotification(notification(saved), "wechat")).status).toBe(204);
    expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("paid");
    expect(await db.paymentNotification.count()).toBe(1);
  });

  it.each([
    { amount: { total: 2, currency: "CNY" } },
    { appid: "other" },
    { mchid: "other" },
    { out_trade_no: "unknown" },
    { trade_state: "NOTPAY" },
  ])("签名正确但业务字段错误时拒绝入账：%j", async (fields) => {
    const saved = await order();
    await expect(
      handleWechatNotification(db, notification(saved, fields), config),
    ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
    expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("pending");
  });

  it.each(["signature", "serial", "timestamp", "ciphertext"])("拒绝通知 %s 异常", async (kind) => {
    const saved = await order();
    const request = notification(saved);
    const headers = new Headers(request.headers);
    let body = await request.text();

    if (kind === "signature") {
      headers.set("Wechatpay-Signature", "invalid");
    }

    if (kind === "serial") {
      headers.set("Wechatpay-Serial", "unknown");
    }

    if (kind === "timestamp") {
      headers.set("Wechatpay-Timestamp", "1000000000");
    }

    if (kind === "ciphertext") {
      const envelope = JSON.parse(body);
      envelope.resource.ciphertext = "invalid";
      body = JSON.stringify(envelope);
      signedResponse(body).headers.forEach((value, key) => headers.set(key, value));
    }

    await expect(
      handleWechatNotification(
        db,
        new Request(config.notifyUrl, { method: "POST", body, headers }),
        config,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
  });

  it("漏通知时通过查单补回支付，迟到的通知不重复入账", async () => {
    const saved = await order();
    queryData = transaction(saved);
    queryStatus = 200;
    expect((await refreshWechatOrder(db, saved, config)).status).toBe("paid");
    await handleWechatNotification(db, notification(saved), config);
    expect(await db.paymentNotification.count()).toBe(1);
  });

  it("并发查询受限频控制，平台无订单时仍保留待付款", async () => {
    const saved = await order();
    await Promise.all([
      refreshWechatOrder(db, saved, config),
      refreshWechatOrder(db, saved, config),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("pending");
  });

  it.each(["CLOSED", "PAYERROR", "NOTPAY"])("处理已验签状态 %s", async (state) => {
    const saved = await order();
    queryData = transaction(saved, { trade_state: state, transaction_id: undefined });
    queryStatus = 200;
    expect((await refreshWechatOrder(db, saved, config)).status).toBe(
      { CLOSED: "closed", PAYERROR: "failed", NOTPAY: "pending" }[state],
    );
  });

  it("未知支付状态与错误金额都不更新订单", async () => {
    for (const fields of [{ trade_state: "UNKNOWN" }, { amount: { total: 99, currency: "CNY" } }]) {
      const saved = await order();
      queryData = transaction(saved, fields);
      queryStatus = 200;
      await expect(refreshWechatOrder(db, saved, config)).rejects.toMatchObject({
        code: "PAYMENT_INVALID",
      });
      expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe(
        "pending",
      );
    }
  });

  it("响应验签失败不能保存二维码，不能标为已支付", async () => {
    const saved = await order();
    corruptSignature = true;
    await expect(createWechatPayment(db, saved, config)).rejects.toMatchObject({
      code: "PAYMENT_INVALID",
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).paymentUrl).toBeNull();
  });

  it("请求中断保留订单并回到该订单页，不自动重发", async () => {
    fetcher.mockRejectedValue(new TypeError("network failed"));
    const response = await createPayment(checkout({ checkoutKey: randomUUID() }), "wechat");
    const saved = await db.order.findFirstOrThrow();
    expect(response.headers.get("location")).toContain(
      `/orders/${saved.id}?error=UPSTREAM_NETWORK`,
    );
    expect(saved.status).toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("下单响应丢失后，重试同一订单先查单，已付款则不再下单", async () => {
    const saved = await order();
    queryData = transaction(saved);
    queryStatus = 200;
    expect((await createWechatPayment(db, saved, config)).status).toBe("paid");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("请求超时返回明确错误，不自动重试", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    fetcher.mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(
      wechatPayRequest("POST", "/v3/pay/transactions/native", {}, z.unknown(), config),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("平台系统异常和无法解析的响应不能改变订单状态", async () => {
    for (const response of [
      signedResponse(JSON.stringify({ code: "SYSTEM_ERROR" }), 500),
      signedResponse("not-json"),
    ]) {
      const saved = await order();
      fetcher.mockResolvedValueOnce(response);
      await expect(createWechatPayment(db, saved, config)).rejects.toBeDefined();
      expect((await db.order.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe(
        "pending",
      );
    }
  });

  it("拒绝模拟订单、其他商户配置和其他用户继续付款", async () => {
    const mock = await order();
    mock.mode = "mock";
    await expect(createWechatPayment(db, mock, config)).rejects.toMatchObject({
      code: "PAYMENT_INVALID",
    });
    const saved = await order();
    await expect(
      createWechatPayment(db, saved, { ...config, merchantId: "other" }),
    ).rejects.toMatchObject({ code: "PAYMENT_INVALID" });
    boundaries.session = { provider: "wechat", user: { id: "other" } };
    expect(
      (await createPayment(checkout({ orderId: saved.id }), "wechat")).headers.get("location"),
    ).toContain("NOT_FOUND");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("微信真实登录路由", () => {
  it("发起网站扫码授权并保存 live 模式及浏览器绑定", async () => {
    const response = await startLogin(
      new NextRequest("https://shop.test/api/auth/wechat/start", {
        headers: { host: "shop.test" },
      }),
      "wechat",
    );
    expect(response.headers.get("location")).toContain("open.weixin.qq.com/connect/qrconnect?");
    expect(response.cookies.get("oauth_wechat")?.value).toMatch(/^[a-f0-9]{64}$/);
    expect((await db.oAuthState.findFirstOrThrow()).mode).toBe("live");
  });

  it("授权回调保存资料和安全会话，重复回调不重复换码", async () => {
    const { state, browser } = await createLoginState(db, "wechat", "live");
    fetcher
      .mockResolvedValueOnce(
        Response.json({ access_token: "test-token", openid: "openid-test", scope: "snsapi_login" }),
      )
      .mockResolvedValueOnce(
        Response.json({ openid: "openid-test", unionid: "union-test", nickname: "真实接口资料" }),
      );
    const url = `https://shop.test/api/auth/wechat/callback?code=test-code&state=${state}`;
    const request = () => new NextRequest(url, { headers: { cookie: `oauth_wechat=${browser}` } });
    const response = await finishLogin(request(), "wechat");
    expect(response.headers.get("location")).toBe("https://shop.test/dashboard");
    const cookie = response.cookies.get("paybridge_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect((await readSession(db, cookie.value))?.user.nickname).toBe("真实接口资料");
    expect((await db.authIdentity.findFirstOrThrow()).unionId).toBe("union-test");
    expect((await finishLogin(request(), "wechat")).headers.get("location")).toContain(
      "OAUTH_STATE_INVALID",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("拒绝跨浏览器回调，取消授权也不会换码", async () => {
    const { state, browser } = await createLoginState(db, "wechat", "live");
    const url = `https://shop.test/api/auth/wechat/callback?state=${state}`;
    expect((await finishLogin(new NextRequest(url), "wechat")).headers.get("location")).toContain(
      "OAUTH_STATE_INVALID",
    );
    expect(
      (
        await finishLogin(
          new NextRequest(url, { headers: { cookie: `oauth_wechat=${browser}` } }),
          "wechat",
        )
      ).headers.get("location"),
    ).toContain("OAUTH_DENIED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

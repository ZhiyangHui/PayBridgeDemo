import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  createLoginState,
  consumeLoginState,
  completeLogin,
  readSession,
  revokeSession,
  tokenHash,
} from "../../src/server/auth/store";

import { createMockCode, exchangeMockCode } from "../../src/server/auth/mock";

const directory = mkdtempSync(path.join(tmpdir(), "paybridge-auth-"));
const database = `file:${path.join(directory, "test.db")}`;
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: database }) });
const profile = { providerUserId: "mock-1", nickname: "测试用户", avatar: null };

beforeAll(() => {
  writeFileSync(path.join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: database },
    stdio: "pipe",
  });
}, 30_000);

beforeEach(async () => {
  await db.session.deleteMany();
  await db.authIdentity.deleteMany();
  await db.user.deleteMany();
  await db.oAuthState.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe("真实 SQLite 登录状态和会话", () => {
  it("state 只保存哈希，消费后不能重放", async () => {
    const { state, browser } = await createLoginState(db, "wechat");
    const row = await db.oAuthState.findFirstOrThrow();
    expect(row.stateHash).not.toBe(state);
    expect(row.browserHash).not.toBe(browser);
    await consumeLoginState(db, "wechat", state, browser);
    await expect(consumeLoginState(db, "wechat", state, browser)).rejects.toMatchObject({
      code: "OAUTH_STATE_INVALID",
    });
  });
  it("跨浏览器或跨渠道不能消费合法 state", async () => {
    const { state, browser } = await createLoginState(db, "wechat");
    await expect(consumeLoginState(db, "wechat", state, "a".repeat(64))).rejects.toMatchObject({
      code: "OAUTH_STATE_INVALID",
    });
    await expect(consumeLoginState(db, "alipay", state, browser)).rejects.toMatchObject({
      code: "OAUTH_STATE_INVALID",
    });
    await expect(consumeLoginState(db, "wechat", state, browser)).resolves.toBe("mock");
  });
  it("授权模式保存在服务端，回调读取原模式且仍只能消费一次", async () => {
    const { state, browser } = await createLoginState(db, "alipay", "sandbox");
    await expect(consumeLoginState(db, "alipay", state, browser)).resolves.toBe("sandbox");
    await expect(consumeLoginState(db, "alipay", state, browser)).rejects.toMatchObject({
      code: "OAUTH_STATE_INVALID",
    });
  });

  it("过期 state 被拒绝", async () => {
    const { state, browser } = await createLoginState(db, "alipay");
    await db.oAuthState.updateMany({ data: { expiresAt: new Date(0) } });
    await expect(consumeLoginState(db, "alipay", state, browser)).rejects.toMatchObject({
      code: "OAUTH_STATE_INVALID",
    });
  });
  it("并发回调最多一次成功", async () => {
    const { state, browser } = await createLoginState(db, "alipay");
    const results = await Promise.allSettled([
      consumeLoginState(db, "alipay", state, browser),
      consumeLoginState(db, "alipay", state, browser),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
  it("重复登录更新资料并撤销旧会话", async () => {
    const old = await completeLogin(db, "wechat", profile);
    const token = await completeLogin(db, "wechat", { ...profile, nickname: "新昵称" }, old);
    expect(await db.user.count()).toBe(1);
    expect(await db.authIdentity.count()).toBe(1);
    expect(await readSession(db, old)).toBeNull();
    expect((await readSession(db, token))?.user.nickname).toBe("新昵称");
    expect((await db.session.findFirstOrThrow()).tokenHash).toBe(tokenHash(token));
  });
  it("不同渠道相同平台 ID 不会误合并账户", async () => {
    await completeLogin(db, "wechat", profile);
    const token = await completeLogin(db, "alipay", profile);
    expect(await db.user.count()).toBe(2);
    expect((await readSession(db, token))?.provider).toBe("alipay");
  });
  it("选择模拟账号后保存对应资料，重登不重复建用户，换号撤销旧会话", async () => {
    const secret = "mock-account-test-secret".repeat(2);
    const primary = exchangeMockCode(
      createMockCode("wechat", "state", secret, {
        providerUserId: "mock_primary",
        nickname: "primary",
        avatar: "/avatars/wechat.svg",
      }),
      "wechat",
      "state",
      secret,
    );
    const secondary = exchangeMockCode(
      createMockCode("wechat", "state", secret, {
        providerUserId: "mock_secondary",
        nickname: "secondary",
        avatar: "/avatars/wechat.svg",
      }),
      "wechat",
      "state",
      secret,
    );
    const first = await completeLogin(db, "wechat", primary);
    const firstUser = (await readSession(db, first))!.user;
    const again = await completeLogin(db, "wechat", primary, first);
    expect((await readSession(db, again))!.user.id).toBe(firstUser.id);
    const switched = await completeLogin(db, "wechat", secondary, again);
    const secondUser = (await readSession(db, switched))!.user;
    expect(secondUser.id).not.toBe(firstUser.id);
    expect(secondUser.nickname).toBe(secondary.nickname);
    expect(secondUser.avatar).toBe(secondary.avatar);
    expect(await readSession(db, again)).toBeNull();
    expect(await db.user.count()).toBe(2);
  });

  it("退出撤销和会话过期后无法访问", async () => {
    const token = await completeLogin(db, "alipay", profile);
    await revokeSession(db, token);
    await revokeSession(db, token);
    expect(await readSession(db, token)).toBeNull();
    const expired = await completeLogin(db, "wechat", profile);
    await db.session.updateMany({ data: { expiresAt: new Date(0) } });
    expect(await readSession(db, expired)).toBeNull();
    expect(await readSession(db, "bad-token")).toBeNull();
  });
});

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import type { LoginProfile, LoginProvider } from "./types";

export const STATE_SECONDS = 600;
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

/** 生成不可预测的令牌，仅原始值交给浏览器。 */
export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** 数据库存哈希，避免数据库泄露后直接复用会话。 */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 为一次授权生成独立 state 和浏览器绑定值。 */
export async function createLoginState(db: PrismaClient, provider: LoginProvider) {
  const state = newToken();
  const browser = newToken();
  await db.oAuthState.create({
    data: {
      stateHash: tokenHash(state),
      browserHash: tokenHash(browser),
      provider,
      expiresAt: new Date(Date.now() + STATE_SECONDS * 1000),
    },
  });

  return { state, browser };
}

/** 原子消费有效 state，阻止跨浏览器、跨渠道、过期和并发重放。 */
export async function consumeLoginState(
  db: PrismaClient,
  provider: LoginProvider,
  state: string,
  browser: string,
) {
  if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser)) {
    throw new AppError("OAUTH_STATE_INVALID");
  }

  const result = await db.oAuthState.updateMany({
    where: {
      stateHash: tokenHash(state),
      browserHash: tokenHash(browser),
      provider,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });

  if (result.count !== 1) {
    throw new AppError("OAUTH_STATE_INVALID");
  }
}

/** 事务内更新平台身份、撤销旧会话并签发新会话，避免会话固定攻击。 */
export async function completeLogin(
  db: PrismaClient,
  provider: LoginProvider,
  profile: LoginProfile,
  oldToken?: string,
) {
  const token = newToken();
  await db.$transaction(async (tx) => {
    const identity = await tx.authIdentity.upsert({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      create: {
        provider,
        providerUserId: profile.providerUserId,
        unionId: profile.unionId,
        user: { create: { nickname: profile.nickname, avatar: profile.avatar } },
      },
      update: {
        unionId: profile.unionId,
        user: { update: { nickname: profile.nickname, avatar: profile.avatar } },
      },
    });

    if (oldToken) {
      await tx.session.deleteMany({ where: { tokenHash: tokenHash(oldToken) } });
    }

    await tx.session.create({
      data: {
        tokenHash: tokenHash(token),
        userId: identity.userId,
        provider,
        expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      },
    });
  });

  return token;
}

/** 读取未过期会话，只返回页面需要的资料。 */
export async function readSession(db: PrismaClient, token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }

  return db.session.findFirst({
    where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() } },
    select: { provider: true, user: { select: { id: true, nickname: true, avatar: true } } },
  });
}

/** 撤销会话；重复退出也能安全完成。 */
export async function revokeSession(db: PrismaClient, token?: string) {
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
}

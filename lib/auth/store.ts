import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import type { LoginProfile, LoginProvider, PaymentMode } from "./types";

// 授权状态有效期为十分钟，会话有效期为七天，单位均为秒。
export const STATE_SECONDS = 600;
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

/**
 * 生成 32 字节随机值，并返回 64 位十六进制字符串。
 * 用于创建授权 state、浏览器绑定值或会话令牌。
 */
export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * 计算令牌的 SHA256 哈希，返回十六进制字符串。
 * @param token 原始授权状态、浏览器绑定值或会话令牌。
 * @returns 用于数据库保存和查询的哈希值。
 */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 生成一次登录所需的 state 和浏览器绑定值，并保存授权记录。
 * 数据库记录渠道、运行模式、两个值的哈希以及十分钟有效期。
 * @returns 原始 state 和 browser，分别用于授权 URL 和浏览器 Cookie。
 */
export async function createLoginState(
  db: PrismaClient,
  provider: LoginProvider,
  mode: PaymentMode = "mock",
  paymentMode: PaymentMode = mode,
) {
  const state = newToken();
  const browser = newToken();
  // 只保存随机值的哈希，原始值留给授权链接和浏览器使用。
  await db.oAuthState.create({
    data: {
      mode,
      paymentMode,
      stateHash: tokenHash(state),
      browserHash: tokenHash(browser),
      provider,
      expiresAt: new Date(Date.now() + STATE_SECONDS * 1000),
    },
  });

  return { state, browser };
}

/**
 * 检查授权状态是否属于当前浏览器和渠道，且未过期、未使用。
 * @param state 回调或表单携带的授权状态。
 * @param browser 浏览器 Cookie 中保存的绑定值。
 * @returns 授权记录的 ID 和运行模式，不修改该记录。
 * @throws AppError 格式不合法或找不到有效记录时抛出 OAUTH_STATE_INVALID。
 */
export async function checkLoginState(
  db: PrismaClient,
  provider: LoginProvider,
  state: string,
  browser: string,
) {
  const valid = /^[a-f0-9]{64}$/.test(state) && /^[a-f0-9]{64}$/.test(browser);
  const record =
    valid &&
    (await db.oAuthState.findFirst({
      where: {
        stateHash: tokenHash(state),
        browserHash: tokenHash(browser),
        provider,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, mode: true, paymentMode: true },
    }));

  if (!record) {
    throw new AppError("OAUTH_STATE_INVALID");
  }

  return record;
}

/**
 * 校验授权状态，并将它标记为已使用。
 * @returns 创建登录请求时保存的授权方式和支付模式。
 * @throws AppError 状态无效或已被另一个请求使用时抛出 OAUTH_STATE_INVALID。
 */
export async function consumeLoginState(
  db: PrismaClient,
  provider: LoginProvider,
  state: string,
  browser: string,
) {
  const record = await checkLoginState(db, provider, state, browser);
  // 再次限制未使用和未过期，确保并发回调只有一个能消费该状态。
  const result = await db.oAuthState.updateMany({
    where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  if (result.count !== 1) {
    throw new AppError("OAUTH_STATE_INVALID");
  }

  return record;
}

/**
 * 根据平台用户资料创建或更新本站用户，并建立新的登录会话。
 * 在同一事务内保存身份资料、删除传入的旧会话、写入新会话。
 * @param profile 已通过平台或模拟授权验证的用户资料。
 * @param oldToken 可选的旧会话令牌，存在时一并撤销。
 * @param paymentMode 由已校验的授权状态提供，不能从回调网址或表单中读取。
 * @returns 新会话的原始令牌，供接口写入 Cookie；数据库只保存哈希。
 */
export async function completeLogin(
  db: PrismaClient,
  provider: LoginProvider,
  profile: LoginProfile,
  oldToken?: string,
  paymentMode: PaymentMode = "mock",
) {
  const token = newToken();
  await db.$transaction(async (tx) => {
    // 按渠道和平台用户 ID 查找身份，首次登录建用户，后续登录更新资料。
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

    // 删除当前浏览器提交的旧会话，随后为本次登录创建新会话。
    if (oldToken) {
      await tx.session.deleteMany({ where: { tokenHash: tokenHash(oldToken) } });
    }

    // 记录登录渠道、用户、令牌哈希和过期时间。
    await tx.session.create({
      data: {
        tokenHash: tokenHash(token),
        userId: identity.userId,
        provider,
        paymentMode,
        expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
      },
    });
  });

  return token;
}

/**
 * 根据浏览器令牌查询未过期的登录会话。
 * @returns 登录渠道及用户 ID、昵称、头像；令牌缺失、格式无效或会话失效时返回 null。
 */
export async function readSession(db: PrismaClient, token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return null;
  }

  return db.session.findFirst({
    where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() } },
    select: {
      provider: true,
      paymentMode: true,
      user: { select: { id: true, nickname: true, avatar: true } },
    },
  });
}

/**
 * 根据令牌删除数据库中的会话。
 * 令牌未提供或会话已不存在时不执行有效删除，也不报错。
 */
export async function revokeSession(db: PrismaClient, token?: string) {
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
}

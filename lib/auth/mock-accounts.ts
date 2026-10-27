import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import { parseMoney } from "../orders/money";
import type { LoginProfile, LoginProvider } from "./types";

const deriveKey = promisify(scrypt);

/**
 * 检查模拟账号和密码格式，并返回规范化后的账号名。
 * 账号去掉两端空白并转为小写，密码保持原样。
 * @throws AppError 账号不是 3–24 位字母、数字或下划线，或密码长度不在 8–128 之间时抛出 INVALID_CREDENTIALS。
 */
function credentials(username: string, password: string) {
  const normalized = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,24}$/.test(normalized) || password.length < 8 || password.length > 128) {
    throw new AppError("INVALID_CREDENTIALS");
  }

  return normalized;
}

/**
 * 注册一个指定渠道的模拟账号，并保存初始余额和对应的本站用户。
 * 密码使用随机盐和 scrypt 计算哈希，头像按登录渠道选择。
 * @param balance 以元为单位的初始余额字符串。
 * @returns 新账号的模拟平台 ID、昵称和头像。
 * @throws AppError 账号重复为 ACCOUNT_EXISTS；账号、密码或金额错误由输入校验抛出。
 */
export async function registerMockAccount(
  db: PrismaClient,
  provider: LoginProvider,
  username: string,
  password: string,
  balance: string,
): Promise<LoginProfile> {
  const name = credentials(username, password);
  const balanceFen = parseMoney(balance);
  // 为本次注册生成独立随机盐，数据库保存盐和密码哈希，不保存明文密码。
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveKey(password, salt, 64)) as Buffer;
  const id = `mock_${randomUUID()}`;
  const avatar = `/avatars/${provider}.svg`;

  try {
    // 一次写入模拟账号、本站用户和平台身份关联，避免只创建了其中一部分。
    await db.mockAccount.create({
      data: {
        id,
        provider,
        username: name,
        passwordHash: `${salt}:${hash.toString("hex")}`,
        balanceFen,
        user: {
          create: {
            nickname: name,
            avatar,
            identities: { create: { provider, providerUserId: id } },
          },
        },
      },
    });
  } catch (cause) {
    // 将数据库唯一键冲突转成账号已存在，其他数据库异常继续上抛。
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "P2002") {
      throw new AppError("ACCOUNT_EXISTS");
    }

    throw cause;
  }

  return { providerUserId: id, nickname: name, avatar };
}

/**
 * 根据渠道和账号查找模拟用户，并核对密码。
 * @returns 验证通过的模拟平台 ID、昵称和头像。
 * @throws AppError 输入格式不符为 INVALID_CREDENTIALS；账号不存在或密码错误均为 LOGIN_FAILED。
 */
export async function loginMockAccount(
  db: PrismaClient,
  provider: LoginProvider,
  username: string,
  password: string,
): Promise<LoginProfile> {
  const name = credentials(username, password);
  const account = await db.mockAccount.findUnique({
    where: { provider_username: { provider, username: name } },
  });
  // 账号不存在时仍计算一次密码哈希，再统一返回登录失败。
  const [salt, expected] = account?.passwordHash.split(":") ?? ["missing-account", "0".repeat(128)];
  const hash = (await deriveKey(password, salt, 64)) as Buffer;

  if (!account || !timingSafeEqual(hash, Buffer.from(expected, "hex"))) {
    throw new AppError("LOGIN_FAILED");
  }

  return {
    providerUserId: account.id,
    nickname: account.username,
    avatar: `/avatars/${provider}.svg`,
  };
}

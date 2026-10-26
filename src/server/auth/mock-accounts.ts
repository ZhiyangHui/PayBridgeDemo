import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PrismaClient } from "../../generated/prisma/client";
import { AppError } from "../errors/app-error";
import { parseMoney } from "../orders/money";
import type { LoginProfile, LoginProvider } from "./types";

const deriveKey = promisify(scrypt);

/** 校验模拟账号输入，统一用户名大小写，不修改密码内容。 */
function credentials(username: string, password: string) {
  const normalized = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,24}$/.test(normalized) || password.length < 8 || password.length > 128) {
    throw new AppError("INVALID_CREDENTIALS");
  }

  return normalized;
}

/** 注册模拟平台账号，同时建立它对应的本地用户身份。 */
export async function registerMockAccount(
  db: PrismaClient,
  provider: LoginProvider,
  username: string,
  password: string,
  balance: string,
): Promise<LoginProfile> {
  const name = credentials(username, password);
  const balanceFen = parseMoney(balance);
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveKey(password, salt, 64)) as Buffer;
  const id = `mock_${randomUUID()}`;
  const avatar = `/avatars/${provider}.svg`;

  try {
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
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "P2002") {
      throw new AppError("ACCOUNT_EXISTS");
    }

    throw cause;
  }

  return { providerUserId: id, nickname: name, avatar };
}

/** 使用加盐密码哈希验证模拟账号，错误不区分账号不存在或密码错误。 */
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

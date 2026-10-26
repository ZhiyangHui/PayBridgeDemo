import type { PrismaClient } from "../../generated/prisma/client";
import type { LoginProvider } from "../auth/types";
import { settleMockPayment } from "../orders/service";
import { verifyNotification, type NotificationConfig } from "./notification";

/** 模拟付款与公开 notify 路由共用处理器，验签成功才更新订单。 */
export async function handleMockNotification(
  db: PrismaClient,
  request: Request,
  provider: LoginProvider,
  config: NotificationConfig,
) {
  const notice = verifyNotification(provider, await request.text(), request.headers, config);
  await settleMockPayment(db, notice);

  if (provider === "alipay") {
    return new Response("success");
  }

  return Response.json({ code: "SUCCESS", message: "成功" });
}

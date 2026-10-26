import type { NextRequest } from "next/server";
import { currentSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ownOrder } from "@/server/orders/service";
import { AppError } from "@/server/errors/app-error";
import { errorResponse } from "@/server/errors/response";

/** 仅返回本人订单的付款状态，不接受浏览器传入的状态。 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await currentSession();

    if (!session) {
      throw new AppError("UNAUTHENTICATED");
    }

    const order = await ownOrder(getDb(), session.user.id, (await context.params).id);

    return Response.json({ status: order.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return errorResponse(cause);
  }
}

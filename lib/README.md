# 后端 / Backend

`wechat.ts`、`alipay.ts` 是平台入口，`session.ts` 管会话，`db.ts` 连数据库。具体登录、支付、订单逻辑分别放在 `auth/`、`payments/`、`orders/`。

`wechat.ts` and `alipay.ts` are provider entry points; `session.ts` handles sessions and `db.ts` connects to the database. Login, payment, and order logic live in `auth/`, `payments/`, and `orders/`.

# 支付

notification 验签与解密；mock-provider 生成平台格式的测试通知；handler 核对通知并交给订单模块记账；routes 处理请求。模拟按钮和公开 notify 入口共用处理器。测试密钥保存在忽略的 .local 中，真实支付尚未接入。

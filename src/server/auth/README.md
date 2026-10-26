# 登录与会话

store 管理 state 和会话；mock-accounts 管理模拟注册及密码验证；mock 签发和验证测试授权码；alipay 负责真实授权。两种模式共用 callback，真实渠道不开放模拟账号接口。

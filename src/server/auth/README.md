# 登录与会话

store 管理一次性 state、平台身份和会话；routes 处理 Cookie 与跳转；mock 验证签名模拟码；alipay 调用真实授权接口。微信真实 OAuth 留到微信接入阶段。

模拟和真实渠道共用 callback，数据库只存令牌哈希。模拟页面不能在该渠道的真实模式下使用。

参考：[支付宝 OAuth 流程](https://developer.alibaba.com/docs/doc.htm?articleId=105942&docType=1&treeId=279)、[官方 Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all)。当前通过 exec 调用 v2 OAuth 并开启响应验签，沙箱换码已通过，会员资料查询仍在排查。

本地沙箱设置 `ALIPAY_DIAGNOSTICS=1` 后，资料接口返回 20000 时会额外做一次签名表单查询，比较 SDK 与直接请求。仅记录错误说明、状态和追踪号到 `.local/alipay-diagnostics.jsonl`，不保存令牌；对照结果不用于建立会话，正式运行禁用。

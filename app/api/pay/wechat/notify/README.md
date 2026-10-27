# 微信通知 / WeChat notification

接收付款通知，验签、解密并核对订单。真实通知成功返回 204，模拟通知返回 SUCCESS，重复通知不重复记账。

Verifies and decrypts payment notifications, then checks the order. Live success returns 204; mock success returns SUCCESS. Repeated notifications do not settle twice.

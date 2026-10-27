/** 业务错误码对应的 HTTP 状态码和用户提示。 */
export const errorDefinitions = {
  OAUTH_STATE_INVALID: [400, "登录请求已失效，请重新登录"],
  OAUTH_CODE_INVALID: [400, "授权码无效，请重新登录"],
  OAUTH_DENIED: [400, "你已取消授权"],
  OAUTH_PROVIDER_ERROR: [502, "登录平台暂时不可用，请稍后重试"],
  FEATURE_UNAVAILABLE: [503, "该登录方式尚未接入"],
  ACCOUNT_EXISTS: [409, "这个账号已注册，请直接登录"],
  LOGIN_FAILED: [401, "账号或密码不正确"],
  INVALID_CREDENTIALS: [400, "账号用 3–24 位字母、数字或下划线，密码用 8–128 位字符"],
  INVALID_AMOUNT: [400, "金额应在 0–1000000 元之间，最多两位小数"],
  INSUFFICIENT_BALANCE: [409, "余额不足，请先调整模拟余额"],
  PAYMENT_MODE_MISMATCH: [403, "付款方式或环境已变化，请返回结算页重新选择"],
  PAYMENT_UNAVAILABLE: [503, "当前支付方式尚未接入"],
  PAYMENT_PROVIDER_ERROR: [502, "支付平台暂时不可用，订单状态仍待确认，请稍后重试"],
  PAYMENT_INVALID: [400, "支付通知校验失败"],
  MOCK_ONLY: [403, "此操作仅支持模拟模式"],
  INVALID_INPUT: [400, "请求参数有误"],
  UNAUTHENTICATED: [401, "请先登录"],
  FORBIDDEN: [403, "没有操作权限"],
  NOT_FOUND: [404, "资源不存在"],
  CONFLICT: [409, "当前状态不允许此操作"],
  CONFIG_ERROR: [500, "服务配置异常"],
  DATABASE_ERROR: [503, "数据服务暂时不可用"],
  UPSTREAM_TIMEOUT: [504, "平台响应超时，请稍后查询结果"],
  UPSTREAM_NETWORK: [502, "暂时无法连接平台"],
  UPSTREAM_RESPONSE: [502, "平台返回异常"],
  REQUEST_CANCELLED: [408, "请求已取消"],
  INTERNAL_ERROR: [500, "服务暂时不可用"],
} as const;

/** 可由接口统一处理的错误码。 */
export type ErrorCode = keyof typeof errorDefinitions;

/** 携带业务错误码、内部说明和原始异常的错误对象。 */
export class AppError extends Error {
  /**
   * 创建指定错误码的业务异常。
   * @param code 用于选择接口状态码和用户提示的业务错误码。
   * @param message 内部错误说明，默认使用该错误码的提示文本。
   * @param options 可通过 cause 保留触发本次错误的原始异常。
   */
  constructor(
    readonly code: ErrorCode,
    message: string = errorDefinitions[code][1],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

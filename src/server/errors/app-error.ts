/** 统一业务错误的状态和安全提示，内部原因只保存在 cause 中。 */
export const errorDefinitions = {
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

/** 保留内部诊断信息；对外提示始终取自固定错误定义。 */
export class AppError extends Error {
  /** 建立业务错误并保留原始原因，不直接将 message 返回给用户。 */
  constructor(readonly code: ErrorCode, message: string = errorDefinitions[code][1], options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
  }
}

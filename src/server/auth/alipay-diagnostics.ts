import "server-only";

/**
 * 清理平台错误说明中的敏感内容，并限制文本长度。
 * 移除指定秘密及其 URL 编码形式，再隐藏链接、邮箱、凭据字段和长标识。
 * @returns 最多 300 个字符的脱敏文本；输入不是字符串时返回 undefined。
 */
export function redactAlipayMessage(value: unknown, secrets: string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  let text = value;

  for (const secret of secrets.filter(Boolean)) {
    for (const variant of [secret, encodeURIComponent(secret)]) {
      text = text.split(variant).join("[redacted]");
    }
  }

  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+/g, "[email]")
    .replace(
      /(?:access_token|refresh_token|auth_token|auth_code|private_key|sign)\s*[=:]\s*[^\s,;]+/gi,
      "[credential]",
    )
    .replace(/[A-Za-z0-9_+/=-]{16,}/g, "[redacted]")
    .replace(/\d{7,}/g, "[number]")
    .slice(0, 300);
}

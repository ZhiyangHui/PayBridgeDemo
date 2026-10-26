import "server-only";

/** 去掉错误说明中的凭据、URL 和身份数据，只保留有助排查的短文本。 */
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

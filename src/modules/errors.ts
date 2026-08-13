// errors.ts — typed error hierarchy with safe, localized messages.

export type AIHubErrorCode =
  | "NO_KEY"
  | "AUTH"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "PARSE"
  | "PROVIDER_UNSUPPORTED"
  | "NO_PROVIDER"
  | "ABORTED"
  | "UNKNOWN";

export class AIHubError extends Error {
  code: AIHubErrorCode;
  status?: number;
  providerId?: string;
  cause?: unknown;

  constructor(
    code: AIHubErrorCode,
    message: string,
    opts: { status?: number; providerId?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AIHubError";
    this.code = code;
    this.status = opts.status;
    this.providerId = opts.providerId;
    this.cause = opts.cause;
  }

  static fromHttp(status: number, providerId?: string, body?: string): AIHubError {
    let code: AIHubErrorCode = "UNKNOWN";
    let message = `HTTP ${status}`;
    if (status === 401 || status === 403) {
      code = "AUTH";
      message = "API 密钥无效或权限不足，请检查密钥与模型访问权限。";
    } else if (status === 404) {
      code = "PROVIDER_UNSUPPORTED";
      message = "模型或接口路径不存在，请检查 baseURL 与模型名称。";
    } else if (status === 429) {
      code = "RATE_LIMIT";
      message = "请求过于频繁（触发限流），请稍后重试或降低并发。";
    } else if (status >= 500) {
      code = "NETWORK";
      message = "服务端错误，请稍后重试。";
    }
    if (body) {
      try {
        const j = JSON.parse(body);
        if (j?.error?.message) message = j.error.message;
      } catch {
        /* keep */
      }
    }
    return new AIHubError(code, message, { status, providerId });
  }

  static fromException(e: any, providerId?: string): AIHubError {
    if (e instanceof AIHubError) return e;
    const status = e?.status ?? e?.response?.status;
    if (status) return AIHubError.fromHttp(status, providerId, e?.responseText || e?.message);
    const name = e?.name || "";
    const msg = e?.message || String(e);
    if (name === "NS_ERROR_ABORT" || msg.includes("abort") || msg.includes("Abort")) {
      return new AIHubError("ABORTED", "已取消。", { providerId, cause: e });
    }
    if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
      return new AIHubError("TIMEOUT", "请求超时，请检查网络或增大超时时间。", {
        providerId,
        cause: e,
      });
    }
    return new AIHubError("UNKNOWN", `调用失败：${msg}`, { providerId, cause: e });
  }

  // Localized, user-facing message (no secrets leaked).
  userMessage(): string {
    return this.message;
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof AIHubError && e.code === "ABORTED";
}

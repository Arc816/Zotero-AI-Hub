// providers/types.ts — shared provider interfaces and a streaming base class.
import { ProviderConfig } from "../config";
import { AIHubError } from "../errors";
import { ApiKeyManager } from "../apiKeyManager";
import { streamSSE, safeJson, SSEEvent } from "../../utils/http";
import { StreamChunk } from "./stream";
import { logWarn } from "../../utils/logger";
import { CancellationSignal } from "../../utils/cancellation";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: CancellationSignal;
  timeout?: number;
}

export interface ModelInfo {
  id: string;
  label?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  capabilities?: string[];
}

export abstract class BaseProvider {
  config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  protected async resolveKey(): Promise<string> {
    return ApiKeyManager.resolve(this.config);
  }

  /** Stream helper: wraps SSE, parses each event via subclass extractDelta. */
  protected async *stream(url: string, headers: Record<string, string>, body: string, opts: ChatOptions): AsyncGenerator<StreamChunk> {
    try {
      for await (const ev of streamSSE(url, {
        method: "POST",
        headers,
        body,
        signal: opts.signal,
        timeout: opts.timeout || 120000,
        providerId: this.config.id,
      })) {
        yield this.handleEvent(ev);
      }
    } catch (e: any) {
      throw AIHubError.fromException(e, this.config.id);
    }
  }

  protected handleEvent(ev: SSEEvent): StreamChunk {
    if (ev.data === "[DONE]") return { delta: "", done: true };
    const j = safeJson(ev.data);
    if (!j) return { delta: "", done: false };
    if (j.error) {
      const status = typeof j.error === "object" ? j.error.status || 400 : 400;
      const msg = typeof j.error === "object" ? j.error.message || JSON.stringify(j.error) : String(j.error);
      throw AIHubError.fromHttp(status, this.config.id, msg);
    }
    const delta = this.extractDelta(j);
    return { delta: delta || "", done: false };
  }

  /** Subclass: pull the incremental text from a parsed SSE JSON object. */
  protected abstract extractDelta(j: any): string;

  /** Subclass: build auth headers. */
  protected abstract authHeaders(key: string): Record<string, string>;

  abstract chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract testConnection(): Promise<void>;
}

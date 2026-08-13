// ollama.ts — local Ollama /api/chat (NDJSON streaming, no API key).
import { BaseProvider, ChatMessage, ChatOptions, ModelInfo } from "./types";
import { StreamChunk } from "./stream";
import { streamLines, requestJSON, safeJson } from "../../utils/http";
import { AIHubError } from "../errors";

export class OllamaProvider extends BaseProvider {
  protected extractDelta(_j: any): string {
    return "";
  }
  protected authHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }
  private endpoint(): string {
    return this.config.baseURL.replace(/\/+$/, "") + "/api/chat";
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk> {
    const body = JSON.stringify({
      model: opts.model,
      messages,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.maxTokens ?? 4096,
      },
    });
    try {
      for await (const line of streamLines(this.endpoint(), {
        method: "POST",
        headers: this.authHeaders(),
        body,
        signal: opts.signal,
        timeout: opts.timeout || 120000,
        providerId: this.config.id,
      })) {
        const j = safeJson(line);
        if (!j) continue;
        if (j.done) {
          yield { delta: "", done: true };
          return;
        }
        yield { delta: j.message?.content || "", done: false };
      }
    } catch (e: any) {
      throw AIHubError.fromException(e, this.config.id);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const url = this.config.baseURL.replace(/\/+$/, "") + "/api/tags";
      const j = await requestJSON(url, {
        method: "GET",
        providerId: this.config.id,
        timeout: 20000,
      });
      const models: ModelInfo[] = (j.models || []).map((m: any) => ({ id: m.name, label: m.name }));
      return models.length ? models : (this.config.models || []).map((id) => ({ id }));
    } catch {
      return (this.config.models || []).map((id) => ({ id }));
    }
  }

  async testConnection(): Promise<void> {
    const models = await this.listModels();
    if (!models.length) {
      throw new AIHubError(
        "NO_PROVIDER",
        "无法连接 Ollama，请确认本地服务已启动（默认 http://localhost:11434）。",
        { providerId: this.config.id }
      );
    }
  }
}

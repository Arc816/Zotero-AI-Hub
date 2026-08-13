// openaiCompat.ts — OpenAI Chat Completions protocol.
// Also serves DeepSeek, Qwen (DashScope compatible-mode), Kimi, OpenRouter,
// and any generic "custom" OpenAI-compatible endpoint by varying baseURL/key.
import { BaseProvider, ChatMessage, ChatOptions, ModelInfo } from "./types";
import { StreamChunk } from "./stream";
import { requestJSON } from "../../utils/http";
import { AIHubError } from "../errors";

export class OpenAICompatProvider extends BaseProvider {
  protected extractDelta(j: any): string {
    return (
      j.choices?.[0]?.delta?.content ??
      j.choices?.[0]?.message?.content ??
      j.choices?.[0]?.text ??
      ""
    );
  }

  protected authHeaders(key: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (key) h["Authorization"] = `Bearer ${key}`;
    return h;
  }

  private endpoint(): string {
    return this.config.baseURL.replace(/\/+$/, "") + "/chat/completions";
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk> {
    const key = await this.resolveKey();
    const payload: any = {
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    };
    if (this.config.kind === "openai" && /^gpt-5/.test(opts.model)) {
      delete payload.temperature;
      delete payload.max_tokens;
      payload.max_completion_tokens = opts.maxTokens ?? 4096;
    }
    const body = JSON.stringify(payload);
    yield* this.stream(this.endpoint(), this.authHeaders(key), body, opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const key = await this.resolveKey();
      const url = this.config.baseURL.replace(/\/+$/, "") + "/models";
      const j = await requestJSON(url, {
        method: "GET",
        headers: this.authHeaders(key),
        providerId: this.config.id,
        timeout: 20000,
      });
      const models: ModelInfo[] = (j.data || []).map((m: any) => ({ id: m.id, label: m.id }));
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
        "无法获取模型列表，请检查 baseURL 与密钥。",
        { providerId: this.config.id }
      );
    }
  }
}

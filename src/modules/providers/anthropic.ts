// anthropic.ts — Anthropic Claude Messages API (SSE).
import { BaseProvider, ChatMessage, ChatOptions, ModelInfo } from "./types";
import { StreamChunk } from "./stream";
import { requestJSON } from "../../utils/http";
import { AIHubError } from "../errors";

export class AnthropicProvider extends BaseProvider {
  protected extractDelta(j: any): string {
    if (j.type === "content_block_delta" && j.delta?.text) return j.delta.text;
    if (j.delta?.text) return j.delta.text;
    return "";
  }

  protected authHeaders(key: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  private endpoint(): string {
    return this.config.baseURL.replace(/\/+$/, "") + "/messages";
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk> {
    const key = await this.resolveKey();
    if (!key) throw new AIHubError("NO_KEY", "缺少 Anthropic API 密钥。", { providerId: this.config.id });
    const sys = messages.filter((m) => m.role === "system").map((m) => m.content);
    const msgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const body = JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      system: sys.join("\n") || undefined,
      messages: msgs,
      stream: true,
    });
    yield* this.stream(this.endpoint(), this.authHeaders(key), body, opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const key = await this.resolveKey();
      if (key) {
        const base = this.config.baseURL.replace(/\/+$/, "") || "https://api.anthropic.com/v1";
        const response = await requestJSON(`${base}/models`, {
          method: "GET",
          headers: this.authHeaders(key),
          providerId: this.config.id,
          timeout: 20000,
        });
        const models = (response?.data || []).map((model: any) => ({
          id: model.id,
          label: model.display_name || model.id,
        })).filter((model: ModelInfo) => !!model.id);
        if (models.length) return models;
      }
    } catch (_) {
      // Fall through to the persisted/offline catalog.
    }
    if (this.config.models?.length) {
      return this.config.models.map((id) => ({ id }));
    }
    return [
      { id: "claude-fable-5", label: "Claude Fable 5" },
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ].map((m) => ({ id: m.id, label: m.label }));
  }

  async testConnection(): Promise<void> {
    const key = await this.resolveKey();
    if (!key) throw new AIHubError("NO_KEY", "缺少 Anthropic API 密钥。", { providerId: this.config.id });
    const url = this.endpoint();
    const body = JSON.stringify({
      model: this.config.defaultModel,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
    });
    await requestJSON(url, {
      method: "POST",
      headers: this.authHeaders(key),
      body,
      providerId: this.config.id,
      timeout: 20000,
    });
  }
}

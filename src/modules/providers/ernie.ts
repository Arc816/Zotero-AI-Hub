// ernie.ts — Baidu ERNIE (Wenxin) via OAuth2 access_token + SSE.
import { BaseProvider, ChatMessage, ChatOptions, ModelInfo } from "./types";
import { StreamChunk } from "./stream";
import { AIHubError } from "../errors";
import { requestJSON } from "../../utils/http";

export class ErnieProvider extends BaseProvider {
  protected extractDelta(j: any): string {
    return j.result ?? j?.choices?.[0]?.delta?.content ?? "";
  }
  protected authHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  private usesQianfanV2(): boolean {
    return /qianfan\.bj\.baidubce\.com\/v2/i.test(this.config.baseURL || "");
  }

  private endpoint(model: string, token: string): string {
    const base = this.config.baseURL.replace(/\/+$/, "") ||
      "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat";
    return `${base}/${model}?access_token=${encodeURIComponent(token)}`;
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk> {
    const token = await this.resolveKey();
    if (!token) throw new AIHubError("NO_KEY", "缺少 ERNIE 凭证。", { providerId: this.config.id });
    if (this.usesQianfanV2()) {
      const endpoint = this.config.baseURL.replace(/\/+$/, "") + "/chat/completions";
      const body = JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_completion_tokens: opts.maxTokens ?? 4096,
        stream: true,
      });
      yield* this.stream(endpoint, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }, body, opts);
      return;
    }
    const body = JSON.stringify({
      messages,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    });
    yield* this.stream(this.endpoint(opts.model, token), this.authHeaders(), body, opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.config.models && this.config.models.length) {
      return this.config.models.map((id) => ({ id }));
    }
    return [
      { id: "ernie-5.1", label: "ERNIE 5.1" },
      { id: "ernie-5.0", label: "ERNIE 5.0" },
      { id: "ernie-5.0-thinking-latest", label: "ERNIE 5.0 Thinking" },
      { id: "ernie-x1.1-preview", label: "ERNIE X1.1 Preview" },
    ].map((m) => ({ id: m.id, label: m.label }));
  }

  async testConnection(): Promise<void> {
    const token = await this.resolveKey();
    if (!token) throw new AIHubError("NO_KEY", "缺少 ERNIE 凭证。", { providerId: this.config.id });
    if (this.usesQianfanV2()) {
      await requestJSON(this.config.baseURL.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: this.config.defaultModel,
          messages: [{ role: "user", content: "ping" }],
          max_completion_tokens: 8,
          stream: false,
        }),
        providerId: this.config.id,
        timeout: 20000,
      });
    }
  }
}

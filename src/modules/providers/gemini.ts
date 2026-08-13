// gemini.ts — Google Gemini generateContent streaming (SSE, key as query param).
import { BaseProvider, ChatMessage, ChatOptions, ModelInfo } from "./types";
import { StreamChunk } from "./stream";
import { requestJSON } from "../../utils/http";
import { AIHubError } from "../errors";

export class GeminiProvider extends BaseProvider {
  protected extractDelta(j: any): string {
    const parts = j.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) return parts.map((p: any) => p.text || "").join("");
    return "";
  }

  protected authHeaders(_key: string): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  private endpoint(model: string): string {
    const base = this.config.baseURL.replace(/\/+$/, "") ||
      "https://generativelanguage.googleapis.com/v1beta";
    return `${base}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      this.config.apiKey || ""
    )}`;
  }

  private toGeminiMessages(messages: ChatMessage[]) {
    const contents: any[] = [];
    let system = "";
    for (const m of messages) {
      if (m.role === "system") {
        system += m.content + "\n";
        continue;
      }
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
    return { contents, system: system.trim() };
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamChunk> {
    const key = await this.resolveKey();
    if (!key) throw new AIHubError("NO_KEY", "缺少 Gemini API 密钥。", { providerId: this.config.id });
    const { contents, system } = this.toGeminiMessages(messages);
    const generationConfig: any = { maxOutputTokens: opts.maxTokens ?? 4096 };
    // Gemini 3.5/3.6 deprecate sampling parameters such as temperature.
    if (!/^gemini-3\.[56]/.test(opts.model)) generationConfig.temperature = opts.temperature ?? 0.7;
    const payload: any = { contents, generationConfig };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const body = JSON.stringify(payload);
    yield* this.stream(this.endpoint(opts.model), this.authHeaders(key), body, opts);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const key = await this.resolveKey();
      if (key) {
        const base = this.config.baseURL.replace(/\/+$/, "") ||
          "https://generativelanguage.googleapis.com/v1beta";
        const response = await requestJSON(`${base}/models?key=${encodeURIComponent(key)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          providerId: this.config.id,
          timeout: 20000,
        });
        const models = (response?.models || [])
          .filter((model: any) => !model.supportedGenerationMethods ||
            model.supportedGenerationMethods.includes("generateContent"))
          .map((model: any) => ({
            id: String(model.name || "").replace(/^models\//, ""),
            label: model.displayName || String(model.name || "").replace(/^models\//, ""),
            inputTokenLimit: model.inputTokenLimit,
            outputTokenLimit: model.outputTokenLimit,
            capabilities: [
              ...(model.thinking ? ["thinking"] : []),
              ...((model.supportedGenerationMethods || []).map(String)),
            ],
          }))
          .filter((model: ModelInfo) => !!model.id);
        if (models.length) return models;
      }
    } catch (_) {
      // Fall through to the persisted/offline catalog.
    }
    if (this.config.models?.length) {
      return this.config.models.map((id) => ({ id }));
    }
    return [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
      { id: "gemini-flash-latest", label: "Gemini Flash Latest" },
    ].map((m) => ({ id: m.id, label: m.label }));
  }

  async testConnection(): Promise<void> {
    const key = await this.resolveKey();
    if (!key) throw new AIHubError("NO_KEY", "缺少 Gemini API 密钥。", { providerId: this.config.id });
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.defaultModel}:generateContent?key=` +
      encodeURIComponent(key);
    await requestJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
      providerId: this.config.id,
      timeout: 20000,
    });
  }
}

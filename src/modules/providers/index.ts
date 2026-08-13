// providers/index.ts — provider factory + registry with routing/failover.
import { ProviderConfig, getProviders, getPref } from "../config";
import { BaseProvider, ChatMessage, ChatOptions } from "./types";
import { StreamChunk } from "./stream";
import { OpenAICompatProvider } from "./openaiCompat";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { ErnieProvider } from "./ernie";
import { CustomProvider } from "./custom";
import { AIHubError, isAbort } from "../errors";
import { logWarn } from "../../utils/logger";

export function createProvider(config: ProviderConfig): BaseProvider {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "gemini":
      return new GeminiProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    case "ernie":
      return new ErnieProvider(config);
    case "custom":
      return new CustomProvider(config);
    case "deepseek":
    case "qwen":
    case "kimi":
    case "openrouter":
    case "openai":
    default:
      return new OpenAICompatProvider(config);
  }
}

export type ChatRequest = ChatOptions & { providerId?: string };

export class ProviderRegistry {
  private instances: BaseProvider[] = [];

  load(): this {
    this.instances = getProviders().map(createProvider);
    return this;
  }

  all(): BaseProvider[] {
    return this.instances;
  }

  byId(id: string): BaseProvider | undefined {
    return this.instances.find((p) => p.config.id === id);
  }

  enabledOrdered(): BaseProvider[] {
    const strategy = getPref("routingStrategy") || "priority";
    const list = this.instances.filter((p) => p.config.enabled);
    if (strategy === "roundRobin") return list;
    return list.sort((a, b) => (a.config.priority || 0) - (b.config.priority || 0));
  }

  default(): BaseProvider | undefined {
    const id = getPref("defaultProviderId");
    if (id) {
      const p = this.byId(id);
      if (p) return p;
    }
    return this.enabledOrdered()[0];
  }

  /** Stream a chat across providers, failing over to the next enabled one. */
  async *chat(messages: ChatMessage[], opts: ChatRequest): AsyncGenerator<StreamChunk> {
    const fallback = getPref("fallbackEnabled") !== false;
    const primary = opts.providerId ? this.byId(opts.providerId) : this.default();
    if (!primary) {
      throw new AIHubError("NO_PROVIDER", "未配置可用厂商，请先在设置中添加。", {});
    }
    const candidates: BaseProvider[] = [primary];
    if (fallback) {
      for (const p of this.enabledOrdered()) {
        if (!candidates.includes(p)) candidates.push(p);
      }
    }
    const tried = new Set<string>();
    let lastErr: any;
    for (const p of candidates) {
      if (tried.has(p.config.id)) continue;
      tried.add(p.config.id);
      // A model selected in the pane belongs to the primary provider. If that
      // provider fails, each fallback must use its own default model.
      const model = p === primary && opts.model ? opts.model : p.config.defaultModel;
      if (!model) {
        lastErr = new AIHubError("PROVIDER_UNSUPPORTED", "未指定模型。", { providerId: p.config.id });
        if (!fallback) break;
        continue;
      }
      try {
        for await (const chunk of p.chat(messages, { ...opts, model })) {
          if (chunk.error) throw chunk.error;
          yield chunk;
        }
        return;
      } catch (e: any) {
        if (isAbort(e)) throw e;
        lastErr = e;
        logWarn("provider failed, failover", p.config.id, e?.message);
        if (!fallback) break;
      }
    }
    throw lastErr || new AIHubError("NO_PROVIDER", "所有厂商均不可用。", {});
  }

  async testAll(): Promise<{ id: string; ok: boolean; message: string }[]> {
    const out: { id: string; ok: boolean; message: string }[] = [];
    for (const p of this.instances) {
      try {
        await p.testConnection();
        out.push({ id: p.config.id, ok: true, message: "OK" });
      } catch (e: any) {
        out.push({ id: p.config.id, ok: false, message: e?.message || String(e) });
      }
    }
    return out;
  }
}

export const registry = new ProviderRegistry();

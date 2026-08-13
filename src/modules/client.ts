// client.ts — friendly unified LLM client over the provider registry.
import { registry, ChatRequest } from "./providers";
import { ChatMessage } from "./providers/types";
import { getPref } from "./config";
import { logDebug } from "../utils/logger";
import { CancellationSignal } from "../utils/cancellation";

export interface CallOptions {
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: CancellationSignal;
}

function num(v: any, fallback: number): number {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

export const LLMClient = {
  /** Stream text deltas from the best available provider (with failover). */
  async *stream(messages: ChatMessage[], opts: CallOptions = {}): AsyncGenerator<string> {
    const temperature = opts.temperature ?? num(getPref("temperature"), 0.7);
    const maxTokens = opts.maxTokens ?? num(getPref("maxTokens"), 4096);
    const req: ChatRequest = {
      providerId: opts.providerId,
      model: opts.model,
      temperature,
      maxTokens,
      signal: opts.signal,
    };
    for await (const chunk of registry.chat(messages, req)) {
      if (chunk.delta) yield chunk.delta;
    }
  },

  /** Convenience: collect the full response. */
  async complete(messages: ChatMessage[], opts: CallOptions = {}): Promise<string> {
    let out = "";
    for await (const d of this.stream(messages, opts)) out += d;
    return out;
  },

  /** Prepend a system message. */
  withSystem(messages: ChatMessage[], system: string): ChatMessage[] {
    if (!system) return messages;
    return [{ role: "system", content: system }, ...messages];
  },
};

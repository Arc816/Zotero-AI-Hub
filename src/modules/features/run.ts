// features/run.ts — shared prompt runner with streaming support.
import { LLMClient, CallOptions } from "../client";
import { resolvePrompt, PromptName } from "../prompts";
import { ChatMessage } from "../providers/types";

export interface RunOpts extends CallOptions {
  onDelta?: (t: string) => void;
  system?: string;
}

export async function runPrompt(
  name: PromptName,
  vars: Record<string, string>,
  opts: RunOpts = {}
): Promise<string> {
  const prompt = resolvePrompt(name, vars);
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  if (opts.onDelta) {
    let out = "";
    for await (const d of LLMClient.stream(messages, opts)) {
      out += d;
      opts.onDelta!(d);
    }
    return out;
  }
  return LLMClient.complete(messages, opts);
}

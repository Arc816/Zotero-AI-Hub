// features/chat.ts — reader/note Q&A with literature context.
import { LLMClient, CallOptions } from "../client";
import { resolvePrompt } from "../prompts";
import { ChatMessage } from "../providers/types";

export interface ChatResult extends CallOptions {
  onDelta?: (t: string) => void;
}

export async function chat(
  question: string,
  context: string,
  opts: ChatResult = {}
): Promise<string> {
  const sys = resolvePrompt("chat", { context });
  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: question },
  ];
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

// features/annotation.ts — AI annotation from selected reader text.
import { runPrompt, RunOpts } from "./run";

export function annotate(text: string, opts: RunOpts = {}): Promise<string> {
  return runPrompt("annotation", { text }, opts);
}

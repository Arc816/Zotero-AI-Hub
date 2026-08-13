// features/mindmap.ts — produce a hierarchical outline for a mind map.
import { runPrompt, RunOpts } from "./run";

export function mindmap(text: string, opts: RunOpts = {}): Promise<string> {
  return runPrompt("mindmap", { text }, opts);
}

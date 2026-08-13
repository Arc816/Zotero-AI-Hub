// features/summary.ts — single/multi-doc summary and deep reading.
import { runPrompt, RunOpts } from "./run";
import { getItemTextAsync, joinItemText } from "./sources";

export async function summarizeItem(item: any, opts: RunOpts = {}): Promise<string> {
  const text = joinItemText(await getItemTextAsync(item));
  return runPrompt("summary", { text }, opts);
}

export async function summarizeMulti(items: any[], opts: RunOpts = {}): Promise<string> {
  const values = await Promise.all(items.map((item) => getItemTextAsync(item)));
  const text = values.map((value) => joinItemText(value)).join("\n\n====\n\n");
  return runPrompt("summary", { text }, opts);
}

export async function deepRead(item: any, opts: RunOpts = {}): Promise<string> {
  const text = joinItemText(await getItemTextAsync(item));
  return runPrompt("summaryDeep", { text }, opts);
}

// Summarize arbitrary text directly (e.g. a reader text selection) without an item.
export function summarizeText(text: string, opts: RunOpts = {}): Promise<string> {
  return runPrompt("summary", { text }, opts);
}

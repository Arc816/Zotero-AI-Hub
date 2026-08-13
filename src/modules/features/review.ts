// features/review.ts — synthesize a literature review from multiple items.
import { runPrompt, RunOpts } from "./run";
import { getItemTextAsync, joinItemText } from "./sources";

export async function reviewItems(items: any[], opts: RunOpts = {}): Promise<string> {
  const values = await Promise.all(items.map((item) => getItemTextAsync(item)));
  const text = values.map((value) => joinItemText(value)).join("\n\n====\n\n");
  return runPrompt("review", { text }, opts);
}

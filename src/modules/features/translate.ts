// features/translate.ts — translate text into a target language.
import { runPrompt, RunOpts } from "./run";

export function translate(
  text: string,
  target = "English",
  opts: RunOpts = {}
): Promise<string> {
  return runPrompt("translate", { text, target }, opts);
}

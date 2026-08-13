// prompts.ts — resolve an editable prompt template with variable substitution.
import { DEFAULT_PROMPTS, getPref } from "./config";

export type PromptName =
  | "summary"
  | "summaryDeep"
  | "annotation"
  | "chat"
  | "translate"
  | "review"
  | "mindmap";

export function resolvePrompt(name: PromptName, vars: Record<string, string>): string {
  const custom = getPref(`prompts.${name}`);
  const tpl = custom && custom.trim() ? custom : DEFAULT_PROMPTS[name] || "";
  let out = tpl;
  for (const k of Object.keys(vars || {})) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), vars[k] || "");
  }
  return out;
}

// config.ts — preference namespace, accessors, and shared types.
import {
  getNamedSecret,
  hydrateProviders,
  isSecretPersisted,
  secureProviders,
  setNamedSecret,
} from "./credentialStore";

export const PREFS_PREFIX = "extensions.zotero.aiHub";

export type PrefKey =
  | "providers"
  | "defaultProviderId"
  | "routingStrategy"
  | "fallbackEnabled"
  | "temperature"
  | "maxTokens"
  | "autoSaveNotes"
  | "taskModels"
  | "outputLanguage"
  | "systemPrompt"
  | "rag.enabled"
  | "rag.embeddingApi"
  | "rag.embeddingKey"
  | "rag.embeddingModel"
  | "rag.topK"
  | "rag.scope"
  | "mcp.enabled"
  | "mcp.port"
  | "mcp.allowRemote"
  | "mcp.write.enabled"
  | "logLevel"
  | "prompts.summary"
  | "prompts.summaryDeep"
  | "prompts.annotation"
  | "prompts.chat"
  | "prompts.translate"
  | "prompts.review"
  | "prompts.mindmap";

// ---------- Persistence (explicit USER branch, persisted to prefs.js) ----------
// IMPORTANT (Zotero 9 quirk): Zotero.Prefs.set/get with `global=true` does NOT
// reliably persist to disk — values can land on the in-memory default branch and
// vanish after a restart, which made saved config disappear on reopen. We now
// write directly to the persisted user branch via Services.prefs and flush to
// disk, so provider config survives both dialog-close and Zotero restart.

function prefService(): any {
  // Services is a global injected by Zotero's chrome environment.
  // @ts-ignore
  if (typeof Services !== "undefined" && Services && Services.prefs) return Services.prefs;
  // @ts-ignore
  const Cc = Components.classes;
  // @ts-ignore
  const Ci = Components.interfaces;
  return Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
}

export function getPref(key: PrefKey | string, _global = true): any {
  const full = `${PREFS_PREFIX}.${key}`;
  try {
    const pb: any = prefService();
    const type = pb.getPrefType(full);
    if (key === "rag.embeddingKey") {
      const secure = getNamedSecret("rag:embeddingKey");
      if (secure) return secure;
    }
    if (type === 0) return undefined; // PREF_INVALID / not set
    if (type === pb.PREF_BOOL) return pb.getBoolPref(full);
    if (type === pb.PREF_INT) return pb.getIntPref(full);
    return pb.getStringPref(full);
  } catch (e) {
    Zotero.debug(`[AIHub] getPref failed for ${key}: ${e}`);
    return undefined;
  }
}

export function setPref(key: PrefKey | string, value: any, _global = true): void {
  const full = `${PREFS_PREFIX}.${key}`;
  try {
    const pb: any = prefService();
    if (key === "rag.embeddingKey") {
      void setNamedSecret("rag:embeddingKey", String(value || ""));
      // Preserve plaintext only until Login Manager confirms persistence.
      // The startup migration removes this fallback on the next successful pass.
      pb.setStringPref(full, isSecretPersisted("rag:embeddingKey") ? "" : String(value || ""));
      return;
    }
    if (typeof value === "boolean") pb.setBoolPref(full, value);
    else if (typeof value === "number") pb.setIntPref(full, value);
    else pb.setStringPref(full, value == null ? "" : String(value));
  } catch (e) {
    Zotero.debug(`[AIHub] setPref failed for ${key}: ${e}`);
  }
}

/** Force queued pref writes to be written to prefs.js immediately. Call once after a batch of writes. */
export function flushPrefs(): void {
  try {
    prefService().savePrefFile(null);
  } catch (e) {
    Zotero.debug(`[AIHub] flushPrefs failed: ${e}`);
  }
}

export function clearPref(key: PrefKey | string, _global = true): void {
  try {
    prefService().clearUserPref(`${PREFS_PREFIX}.${key}`);
  } catch (e) {
    /* ignore */
  }
}

export function addPrefObserver(key: string, callback: () => void): void {
  const branch = `${PREFS_PREFIX}.${key}`;
  const observer = {
    observe: (_subject: any, _topic: string, _pref: string) => callback(),
  };
  try {
    // Watch the same persisted user branch that we write to.
    prefService().addObserver(branch, observer, false);
  } catch (e) {
    Zotero.debug(`[AIHub] addPrefObserver failed: ${e}`);
  }
}

// ---------- Provider configuration model ----------

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "deepseek"
  | "qwen"
  | "ernie"
  | "kimi"
  | "openrouter"
  | "custom";

export interface ProviderConfig {
  id: string; // unique id
  kind: ProviderKind;
  label: string; // human label
  baseURL: string; // API base, e.g. https://api.openai.com/v1
  apiKey: string; // may be empty for local/ollama
  defaultModel: string;
  models: string[]; // known models (for quick select)
  enabled: boolean;
  priority: number; // lower = tried first
  modelsRefreshedAt?: number;
  extraHeaders?: Record<string, string>;
  // For ERNIE: apiKey is AK, apiSecret is SK used to mint access_token.
  apiSecret?: string;
  // For Gemini: API key passed as query param.
  // For Ollama: baseURL points at http://localhost:11434
}

export type TaskModelKind = "summary" | "annotation" | "chat" | "translate" | "review";

export interface TaskModelChoice {
  providerId?: string;
  model?: string;
}

export function getTaskModel(task: TaskModelKind): TaskModelChoice {
  try {
    const raw = getPref("taskModels");
    const values = raw ? JSON.parse(raw) : {};
    return values?.[task] || {};
  } catch {
    return {};
  }
}

export function saveTaskModel(task: TaskModelKind, choice: TaskModelChoice): void {
  let values: Record<string, TaskModelChoice> = {};
  try { values = JSON.parse(getPref("taskModels") || "{}"); } catch (_) {}
  values[task] = { providerId: choice.providerId || "", model: choice.model || "" };
  setPref("taskModels", JSON.stringify(values));
}

export function getProviders(): ProviderConfig[] {
  const raw = getPref("providers");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? hydrateProviders(arr) : [];
  } catch {
    return [];
  }
}

export function saveProviders(list: ProviderConfig[]): void {
  setPref("providers", JSON.stringify(secureProviders(list)));
}

export function getProviderById(id: string): ProviderConfig | undefined {
  return getProviders().find((p) => p.id === id);
}

// ---------- Default prompt templates (editable in dashboard) ----------

export const DEFAULT_PROMPTS: Record<string, string> = {
  summary:
    "请用结构化的方式为以下学术文献内容生成摘要，包含：研究背景、研究问题、方法、主要发现、局限与启示。使用中文，控制在 400 字以内。\n\n文献内容：\n{{text}}",
  summaryDeep:
    "你是一位严谨的文献分析助手。请对以下文献进行多轮深度阅读，逐节提炼核心论点、证据强度、与既有研究的异同，并给出可引用的关键句。输出 Markdown。\n\n文献内容：\n{{text}}",
  annotation:
    "请基于以下选中文本，生成一段学术批注（comment），指出其观点、潜在问题或值得进一步探讨之处。简洁、有见地，中文。\n\n选中文本：\n{{text}}",
  chat:
    "你是嵌入在 Zotero 阅读器中的研究助手。请基于用户提供的文献上下文回答用户问题，引用原文并说明出处。\n\n文献上下文：\n{{context}}",
  translate:
    "请将以下内容翻译成{{target}}，保持学术语气与术语准确，保留 Markdown 格式：\n\n{{text}}",
  review:
    "你是文献综述专家。请综合以下多篇文献的核心贡献、方法、结论与争议，撰写一篇连贯的综述（含小标题与过渡），中文，Markdown。\n\n文献集：\n{{text}}",
  mindmap:
    "请将以下内容提炼为层级化的思维导图节点（每级用 - 表示缩进，最多 4 级），仅保留关键词与核心关系，不要解释：\n\n{{text}}",
};

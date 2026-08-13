import {
  ProviderConfig,
  ProviderKind,
  flushPrefs,
  getProviders,
  saveProviders,
} from "./config";

/**
 * Built-in fallbacks verified against vendor documentation on 2026-08-13.
 * Providers exposing GET /models can refresh these at runtime from the pane.
 */
export const MODEL_PRESETS: Record<
  ProviderKind,
  { baseURL: string; models: string[]; defaultModel: string; dynamic?: boolean }
> = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    defaultModel: "gpt-5.6",
    dynamic: true,
  },
  anthropic: {
    baseURL: "https://api.anthropic.com/v1",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    defaultModel: "claude-opus-5",
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"],
    defaultModel: "gemini-3.6-flash",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash",
    dynamic: true,
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.7-plus", "qwen3.7-max", "qwen3.7-flash", "qwen3.8-max-preview"],
    defaultModel: "qwen3.7-plus",
    dynamic: true,
  },
  ernie: {
    baseURL: "https://qianfan.bj.baidubce.com/v2",
    models: ["ernie-5.1", "ernie-5.0", "ernie-5.0-thinking-latest", "ernie-x1.1-preview"],
    defaultModel: "ernie-5.1",
  },
  kimi: {
    baseURL: "https://api.moonshot.cn/v1",
    models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
    defaultModel: "kimi-k2.6",
    dynamic: true,
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    models: ["openrouter/auto", "openai/gpt-5.6", "anthropic/claude-sonnet-5", "google/gemini-3.6-flash"],
    defaultModel: "openrouter/auto",
    dynamic: true,
  },
  ollama: {
    baseURL: "http://localhost:11434",
    models: ["llama4", "qwen3.5", "deepseek-r1", "gemma3"],
    defaultModel: "llama4",
    dynamic: true,
  },
  custom: { baseURL: "", models: [], defaultModel: "", dynamic: true },
};

const LEGACY_MODELS: Partial<Record<ProviderKind, Set<string>>> = {
  openai: new Set(["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]),
  anthropic: new Set([
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ]),
  gemini: new Set(["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"]),
  deepseek: new Set(["deepseek-chat", "deepseek-reasoner"]),
  qwen: new Set(["qwen-plus", "qwen-max", "qwen-turbo"]),
  ernie: new Set(["ernie-4.0-8k", "ernie-3.5-8k", "ernie-speed-8k", "ernie-lite-8k"]),
  kimi: new Set(["moonshot-v1-8k", "moonshot-v1-32k"]),
  openrouter: new Set(["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-pro-1.5"]),
};

export function knownModels(config: ProviderConfig): string[] {
  const preset = MODEL_PRESETS[config.kind];
  // Once the provider has returned a live list, prefer it over the dated
  // built-in fallback. Keep the selected/custom model so users are never
  // locked out of an alias their account supports.
  const source = config.modelsRefreshedAt ? (config.models || []) : [...(config.models || []), ...preset.models];
  return [...new Set([config.defaultModel, ...source].filter(Boolean))];
}

/** Upgrade only model IDs that were shipped by older AI Hub releases. */
export function migrateModelCatalog(): boolean {
  const providers = getProviders();
  let changed = false;
  for (const provider of providers) {
    const preset = MODEL_PRESETS[provider.kind];
    if (!preset) continue;
    const legacyErnieCredential = provider.kind === "ernie" && !!provider.apiSecret &&
      !/qianfan\.bj\.baidubce\.com\/v2/i.test(provider.baseURL || "");
    if (provider.kind === "ernie" && !legacyErnieCredential && !provider.baseURL) {
      provider.baseURL = preset.baseURL;
      changed = true;
    }
    if (!legacyErnieCredential && LEGACY_MODELS[provider.kind]?.has(provider.defaultModel)) {
      provider.defaultModel = preset.defaultModel;
      changed = true;
    }
    const models = knownModels(provider);
    if (JSON.stringify(models) !== JSON.stringify(provider.models || [])) {
      provider.models = models;
      changed = true;
    }
  }
  if (changed) {
    saveProviders(providers);
    flushPrefs();
  }
  return changed;
}

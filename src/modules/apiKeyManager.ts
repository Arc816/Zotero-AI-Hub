// apiKeyManager.ts — resolves the effective API key/credential for a provider.
// Handles ERNIE's OAuth2 access_token minting (cached) and local providers
// that need no key. Registry-level failover across providers is handled by
// ProviderRegistry, not here.
import { ProviderConfig } from "./config";
import { requestJSON } from "../utils/http";
import { logWarn } from "../utils/logger";

const ernieCache: Record<string, { token: string; exp: number }> = {};

export const ApiKeyManager = {
  /** Synchronous best-effort (returns stored key; null for ernie until minted). */
  getRaw(config: ProviderConfig): string {
    return config.apiKey || "";
  },

  /** Async resolve — mints ERNIE access_token on demand with a 24h cache. */
  async resolve(config: ProviderConfig): Promise<string> {
    if (config.kind === "ernie") {
      // Current Qianfan v2 uses one bearer API key. Keep OAuth AK/SK support
      // for existing legacy endpoint configurations.
      if (/qianfan\.bj\.baidubce\.com\/v2/i.test(config.baseURL || "")) return config.apiKey || "";
      return this.ernieToken(config);
    }
    if (config.kind === "ollama") return "";
    return config.apiKey || "";
  },

  async ernieToken(config: ProviderConfig): Promise<string> {
    const ak = config.apiKey || "";
    const sk = config.apiSecret || "";
    if (!ak || !sk) {
      throw new Error("ERNIE 需要同时填写 API Key(AK) 与 Secret Key(SK)");
    }
    const cached = ernieCache[ak];
    if (cached && cached.exp > Date.now() + 60000) return cached.token;
    const url =
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(ak)}&client_secret=${encodeURIComponent(sk)}`;
    const j = await requestJSON(url, {
      method: "POST",
      providerId: config.id,
      timeout: 20000,
    });
    if (!j?.access_token) throw new Error("ERNIE 获取 access_token 失败：" + JSON.stringify(j));
    ernieCache[ak] = { token: j.access_token, exp: Date.now() + (j.expires_in || 86400) * 1000 };
    return j.access_token;
  },

  clearCache(): void {
    for (const k of Object.keys(ernieCache)) delete ernieCache[k];
  },
};

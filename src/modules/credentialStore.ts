// credentialStore.ts — Firefox/Zotero Login Manager backed secret storage.
import type { ProviderConfig } from "./config";

const ORIGIN = "https://zotero-ai-hub.invalid";
const REALM = "Zotero AI Hub credentials";
const cache = new Map<string, string>();
const persisted = new Set<string>();
let initialized = false;

function username(providerID: string, field: "apiKey" | "apiSecret"): string {
  return `provider:${providerID}:${field}`;
}

function loginManager(): any {
  return Services?.logins;
}

function createLogin(user: string, password: string): any {
  const login = Components.classes["@mozilla.org/login-manager/loginInfo;1"]
    .createInstance(Components.interfaces.nsILoginInfo);
  login.init(ORIGIN, null, REALM, user, password, "", "");
  return login;
}

async function allLogins(): Promise<any[]> {
  const manager = loginManager();
  if (!manager) return [];
  try {
    if (manager.searchLoginsAsync) return await manager.searchLoginsAsync({ origin: ORIGIN, httpRealm: REALM });
    if (manager.findLogins) return manager.findLogins(ORIGIN, null, REALM) || [];
  } catch (error) {
    Zotero.debug("[AIHub] credential lookup failed: " + error);
  }
  return [];
}

async function persist(user: string, password: string): Promise<boolean> {
  cache.set(user, password);
  const manager = loginManager();
  if (!manager) return false;
  try {
    const matches = (await allLogins()).filter((login) => login.username === user);
    if (!password) {
      for (const login of matches) {
        if (manager.removeLoginAsync) await manager.removeLoginAsync(login);
        else manager.removeLogin(login);
      }
      cache.delete(user);
      persisted.delete(user);
      return true;
    }
    const next = createLogin(user, password);
    if (matches.length) {
      if (manager.modifyLoginAsync) await manager.modifyLoginAsync(matches[0], next);
      else manager.modifyLogin(matches[0], next);
    } else if (manager.addLoginAsync) {
      await manager.addLoginAsync(next);
    } else {
      manager.addLogin(next);
    }
    persisted.add(user);
    return true;
  } catch (error) {
    // Keep the in-memory secret for this session and never put it in logs.
    Zotero.debug("[AIHub] secure credential persistence failed: " + (error?.name || "unknown error"));
    return false;
  }
}

export async function initializeCredentialStore(): Promise<void> {
  if (initialized) return;
  try {
    await loginManager()?.initializationPromise;
  } catch (_) {}
  for (const login of await allLogins()) {
    if (String(login.username || "").startsWith("provider:") || login.username === "rag:embeddingKey") {
      cache.set(login.username, login.password || "");
      persisted.add(login.username);
    }
  }
  initialized = true;
}

export function getProviderCredential(providerID: string, field: "apiKey" | "apiSecret"): string {
  return cache.get(username(providerID, field)) || "";
}

/** Capture provider secrets and return a clone safe for ordinary preferences. */
export function secureProviders(list: ProviderConfig[]): ProviderConfig[] {
  const allowed = new Set<string>();
  const result = list.map((provider) => {
    const keyUser = username(provider.id, "apiKey");
    const secretUser = username(provider.id, "apiSecret");
    allowed.add(keyUser);
    allowed.add(secretUser);
    if (provider.apiKey && !persisted.has(keyUser)) void persist(keyUser, provider.apiKey);
    if (provider.apiSecret && !persisted.has(secretUser)) void persist(secretUser, provider.apiSecret);
    return {
      ...provider,
      apiKey: persisted.has(keyUser) ? "" : provider.apiKey,
      apiSecret: persisted.has(secretUser) ? undefined : provider.apiSecret,
    };
  });
  for (const user of [...cache.keys()]) {
    if (user.startsWith("provider:") && !allowed.has(user)) void persist(user, "");
  }
  return result;
}

export function hydrateProviders(list: ProviderConfig[]): ProviderConfig[] {
  return list.map((provider) => ({
    ...provider,
    apiKey: provider.apiKey || getProviderCredential(provider.id, "apiKey"),
    apiSecret: provider.apiSecret || getProviderCredential(provider.id, "apiSecret") || undefined,
  }));
}

export function getNamedSecret(name: "rag:embeddingKey"): string {
  return cache.get(name) || "";
}

export function setNamedSecret(name: "rag:embeddingKey", value: string): Promise<boolean> {
  return persist(name, value || "");
}

export function isSecretPersisted(name: string): boolean {
  return persisted.has(name);
}

export async function migrateProviderCredentials(list: ProviderConfig[]): Promise<boolean> {
  let ok = true;
  for (const provider of list) {
    if (provider.apiKey) ok = (await persist(username(provider.id, "apiKey"), provider.apiKey)) && ok;
    if (provider.apiSecret) ok = (await persist(username(provider.id, "apiSecret"), provider.apiSecret)) && ok;
  }
  return ok;
}

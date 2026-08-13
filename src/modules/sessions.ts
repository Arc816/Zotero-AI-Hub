// sessions.ts — persistent, per-document AI output history.

export type SessionStatus = "complete" | "running" | "stopped" | "error";

export interface SessionEntry {
  id: string;
  title: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  providerId?: string;
  model?: string;
  question?: string;
  context?: string;
  actionKind?: string;
  noteItemID?: number;
  status: SessionStatus;
  error?: string;
}

interface SessionStore {
  version: 1;
  documents: Record<string, SessionEntry[]>;
}

const MAX_DOCUMENTS = 250;
const MAX_ENTRIES = 60;
const MAX_ENTRY_TEXT = 120000;
let cache: SessionStore | null = null;

function path(): string {
  try {
    // Zotero.Profile is not available in every Zotero 8 add-on sandbox.
    // DataDirectory is stable and keeps the per-document history alongside
    // the active Zotero database instead of silently falling back to a
    // relative, unwritable path.
    return Zotero.DataDirectory.dir + "/aihub-sessions.json";
  } catch {
    return "aihub-sessions.json";
  }
}

function empty(): SessionStore {
  return { version: 1, documents: {} };
}

function normalize(raw: any): SessionStore {
  if (!raw || typeof raw !== "object" || typeof raw.documents !== "object") return empty();
  return { version: 1, documents: raw.documents || {} };
}

function load(): SessionStore {
  if (cache) return cache;
  try {
    const file = Zotero.File.pathToFile(path());
    if (!file.exists()) return (cache = empty());
    cache = normalize(JSON.parse(Zotero.File.getContents(file)));
  } catch (error) {
    Zotero.debug("[AIHub] session load failed: " + error);
    cache = empty();
  }
  return cache;
}

function save(): void {
  const store = load();
  try {
    const keys = Object.keys(store.documents);
    if (keys.length > MAX_DOCUMENTS) {
      keys
        .sort((a, b) => {
          const ae = store.documents[a] || [];
          const be = store.documents[b] || [];
          const av = ae[ae.length - 1]?.updatedAt || 0;
          const bv = be[be.length - 1]?.updatedAt || 0;
          return bv - av;
        })
        .slice(MAX_DOCUMENTS)
        .forEach((key) => delete store.documents[key]);
    }
    Zotero.File.putContents(Zotero.File.pathToFile(path()), JSON.stringify(store));
  } catch (error) {
    Zotero.debug("[AIHub] session save failed: " + error);
  }
}

function key(itemID: any): string {
  const value = Number(itemID);
  return Number.isFinite(value) && value > 0 ? String(value) : "global";
}

function clone(entry: SessionEntry): SessionEntry {
  return { ...entry };
}

export const sessions = {
  list(itemID: any): SessionEntry[] {
    return (load().documents[key(itemID)] || []).map(clone);
  },

  add(itemID: any, value: Omit<SessionEntry, "id" | "createdAt" | "updatedAt">): SessionEntry {
    const store = load();
    const docKey = key(itemID);
    const now = Date.now();
    const safeContext = String(value.context || "");
    const entry: SessionEntry = {
      ...value,
      id: `out-${now}-${Math.random().toString(36).slice(2)}`,
      createdAt: now,
      updatedAt: now,
      text: String(value.text || "").slice(0, MAX_ENTRY_TEXT),
      // Context may contain entire copyrighted papers. Retain only a short
      // replay excerpt locally; normal per-document context is reloaded from Zotero.
      context: safeContext.length > 12000 ? safeContext.slice(0, 12000) + "\n[上下文已截断]" : safeContext,
    };
    const entries = store.documents[docKey] || (store.documents[docKey] = []);
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    save();
    return clone(entry);
  },

  update(itemID: any, entryID: string, patch: Partial<SessionEntry>, persist = true): SessionEntry | null {
    const entry = (load().documents[key(itemID)] || []).find((candidate) => candidate.id === entryID);
    if (!entry) return null;
    Object.assign(entry, patch, { updatedAt: Date.now() });
    entry.text = String(entry.text || "").slice(0, MAX_ENTRY_TEXT);
    if (persist) save();
    return clone(entry);
  },

  remove(itemID: any, entryID: string): void {
    const store = load();
    const docKey = key(itemID);
    store.documents[docKey] = (store.documents[docKey] || []).filter((entry) => entry.id !== entryID);
    save();
  },

  clear(itemID: any): void {
    delete load().documents[key(itemID)];
    save();
  },

  flush(): void {
    save();
  },
};

// features/rag.ts — incremental source-aware semantic index.
import { getPref } from "../config";
import { getItemTextAsync, SourceSegment } from "./sources";
import { requestJSON } from "../../utils/http";
import { logWarn } from "../../utils/logger";
import { CancellationSignal } from "../../utils/cancellation";

interface VecRecord {
  id: string;
  itemID?: number;
  attachmentID?: number;
  title: string;
  text: string;
  source: string;
  pageLabel?: string;
  updatedAt: number;
  vec: number[];
}

export interface RagHit {
  id: string;
  itemID?: number;
  attachmentID?: number;
  title: string;
  text: string;
  source: string;
  pageLabel?: string;
  score: number;
}

function storePath(): string {
  try {
    return Zotero.Profile.dir + "/aihub-vectors-v2.json";
  } catch {
    return "aihub-vectors-v2.json";
  }
}

function loadStore(): VecRecord[] {
  try {
    const file = Zotero.File.pathToFile(storePath());
    if (!file.exists()) return [];
    const raw = JSON.parse(Zotero.File.getContents(file));
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    logWarn("rag loadStore", error);
    return [];
  }
}

function saveStore(records: VecRecord[]): void {
  try {
    Zotero.File.putContents(Zotero.File.pathToFile(storePath()), JSON.stringify(records));
  } catch (error) {
    logWarn("rag saveStore", error);
  }
}

async function embed(text: string, signal?: CancellationSignal): Promise<number[]> {
  const api = String(getPref("rag.embeddingApi") || "").replace(/\/+$/, "");
  const key = getPref("rag.embeddingKey");
  const model = getPref("rag.embeddingModel") || "text-embedding-3-small";
  if (!api) throw new Error("未配置 Embedding 端点（设置 → RAG）");
  const url = /\/embeddings$/i.test(api) ? api : api + "/embeddings";
  const response = await requestJSON(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ input: text, model }),
    timeout: 30000,
    signal,
  });
  return response?.data?.[0]?.embedding || [];
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function split(source: SourceSegment, size = 1800, overlap = 200): SourceSegment[] {
  if (source.text.length <= size) return [source];
  const out: SourceSegment[] = [];
  for (let start = 0, index = 1; start < source.text.length; start += size - overlap, index++) {
    let end = Math.min(start + size, source.text.length);
    if (end < source.text.length) {
      const boundary = Math.max(source.text.lastIndexOf("\n", end), source.text.lastIndexOf("。", end));
      if (boundary > start + size * 0.55) end = boundary + 1;
    }
    const value = source.text.slice(start, end).trim();
    if (value) out.push({ ...source, id: `${source.id}:part:${index}`, text: value, chunk: index });
    if (end >= source.text.length) break;
  }
  return out;
}

function label(source: SourceSegment): string {
  if (source.pageLabel) return `${source.title} · 第 ${source.pageLabel} 页`;
  if (source.kind === "annotation") return `${source.title} · PDF 批注`;
  if (source.kind === "note") return `${source.title} · Zotero 笔记`;
  if (source.kind === "metadata") return `${source.title} · 摘要`;
  return `${source.title} · 全文片段 ${source.chunk || ""}`.trim();
}

/** Incrementally replace records for selected items and retain all other indexed documents. */
export async function indexItems(items: any[]): Promise<number> {
  const existing = loadStore();
  const selectedIDs = new Set<number>();
  const additions: VecRecord[] = [];
  for (const item of items) {
    const value = await getItemTextAsync(item);
    const itemID = Number(value.itemID || item?.id);
    if (itemID) selectedIDs.add(itemID);
    const sources = value.sources.flatMap((source) => split(source));
    for (const source of sources) {
      if (!source.text.trim()) continue;
      const vec = await embed(source.text.slice(0, 6000));
      if (!vec.length) continue;
      additions.push({
        id: source.id,
        itemID: source.itemID || itemID,
        attachmentID: source.attachmentID,
        title: source.title || value.title,
        text: source.text,
        source: label(source),
        pageLabel: source.pageLabel,
        updatedAt: Date.now(),
        vec,
      });
    }
  }
  saveStore([...existing.filter((record) => !selectedIDs.has(Number(record.itemID))), ...additions]);
  return additions.length;
}

export function removeItems(itemIDs: any[]): number {
  const ids = new Set(itemIDs.map(Number).filter(Boolean));
  const old = loadStore();
  const next = old.filter((record) => !ids.has(Number(record.itemID)));
  saveStore(next);
  return old.length - next.length;
}

export async function search(query: string, k = 5, itemIDs: any[] = [], signal?: CancellationSignal): Promise<RagHit[]> {
  let records = loadStore();
  const scope = new Set(itemIDs.map(Number).filter(Boolean));
  if (scope.size) records = records.filter((record) => scope.has(Number(record.itemID)));
  if (!records.length) return [];
  const qv = await embed(query, signal);
  return records
    .map((record) => ({ ...record, score: cosine(qv, record.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, k))
    .map(({ vec: _vec, updatedAt: _updatedAt, ...hit }) => hit);
}

export function formatHits(hits: RagHit[]): string {
  return hits.map((hit, index) => `[RAG-${index + 1}｜${hit.source}｜source=${hit.id}]\n${hit.text}`).join("\n\n");
}

export function stats(): { chunks: number; documents: number } {
  const records = loadStore();
  return { chunks: records.length, documents: new Set(records.map((record) => record.itemID).filter(Boolean)).size };
}

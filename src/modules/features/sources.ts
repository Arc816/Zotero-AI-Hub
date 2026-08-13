// features/sources.ts — source-aware extraction from Zotero items and attachments.

export type SourceKind = "metadata" | "fulltext" | "annotation" | "note";

export interface SourceSegment {
  id: string;
  kind: SourceKind;
  title: string;
  text: string;
  itemID?: number;
  attachmentID?: number;
  pageLabel?: string;
  chunk?: number;
}

export interface ItemText {
  title: string;
  abstract: string;
  notes: string[];
  annotations: string[];
  fullText: string;
  itemID?: number;
  sources: SourceSegment[];
}

function text(value: any): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function plainNote(value: any): string {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageLabel(annotation: any): string {
  const direct = text(annotation?.annotationPageLabel || annotation?.pageLabel);
  if (direct) return direct;
  try {
    const position = typeof annotation?.annotationPosition === "string"
      ? JSON.parse(annotation.annotationPosition)
      : annotation?.annotationPosition;
    const page = Number(position?.pageIndex);
    return Number.isFinite(page) ? String(page + 1) : "";
  } catch {
    return "";
  }
}

function itemTitle(item: any): string {
  try {
    return text(item?.getField?.("title") || item?.attachmentFilename || "未命名文献");
  } catch {
    return "未命名文献";
  }
}

function getSyncItem(id: any): any {
  try {
    return Zotero.Items.get(id);
  } catch {
    return null;
  }
}

function collectAnnotation(annotation: any, attachment: any, title: string, out: ItemText): void {
  const selected = text(annotation?.annotationText || annotation?.getAnnotationText?.());
  const comment = plainNote(annotation?.annotationComment || annotation?.getNote?.());
  if (!selected && !comment) return;
  const page = pageLabel(annotation);
  const combined = `${selected}${comment ? `${selected ? "\n" : ""}批注：${comment}` : ""}`;
  out.annotations.push(combined);
  out.sources.push({
    id: `annotation:${annotation?.id || out.sources.length}`,
    kind: "annotation",
    title,
    text: combined,
    itemID: out.itemID,
    attachmentID: Number(attachment?.id) || undefined,
    pageLabel: page || undefined,
  });
}

function collectChildren(item: any, out: ItemText): any[] {
  const attachments: any[] = [];
  try {
    const childIDs = item?.isAttachment?.() ? [item.id] : item?.getAttachments?.() || [];
    for (const id of childIDs) {
      const attachment = typeof id === "object" ? id : getSyncItem(id);
      if (!attachment) continue;
      attachments.push(attachment);
      const title = itemTitle(attachment);
      for (const annotation of attachment.getAnnotations?.() || []) {
        collectAnnotation(annotation, attachment, title, out);
      }
    }
  } catch (error) {
    Zotero.debug("[AIHub] collect attachments/annotations failed: " + error);
  }

  try {
    const children = item?.getChildren?.() || [];
    for (const childValue of children) {
      const child = typeof childValue === "object" ? childValue : getSyncItem(childValue);
      if (!child) continue;
      const type = child.getType?.();
      if (type === Zotero.ItemTypes.note || child.isNote?.()) {
        const note = plainNote(child.getNote?.());
        if (!note) continue;
        out.notes.push(note);
        out.sources.push({
          id: `note:${child.id || out.sources.length}`,
          kind: "note",
          title: itemTitle(item),
          text: note,
          itemID: out.itemID,
        });
      }
    }
  } catch (error) {
    Zotero.debug("[AIHub] collect notes failed: " + error);
  }
  return attachments;
}

/** Fast metadata extraction. Use getItemTextAsync() when PDF full text is required. */
export function getItemText(item: any): ItemText {
  const title = itemTitle(item);
  const abstract = text(item?.getField?.("abstractNote"));
  const out: ItemText = {
    title,
    abstract,
    notes: [],
    annotations: [],
    fullText: "",
    itemID: Number(item?.parentItemID || item?.id) || undefined,
    sources: [],
  };
  if (abstract) {
    out.sources.push({
      id: `abstract:${out.itemID || 0}`,
      kind: "metadata",
      title,
      text: abstract,
      itemID: out.itemID,
    });
  }
  collectChildren(item, out);
  return out;
}

async function readAttachmentText(attachment: any): Promise<string> {
  try {
    const indexed = await attachment?.attachmentText;
    if (text(indexed)) return text(indexed);
  } catch (_) {}
  try {
    const content = await Zotero.Fulltext?.getItemContent?.(attachment.id);
    if (text(content?.content)) return text(content.content);
  } catch (_) {}
  try {
    const cache = Zotero.Fulltext?.getItemCacheFile?.(attachment);
    if (cache?.path) {
      const raw = Zotero.File.getContentsAsync
        ? await Zotero.File.getContentsAsync(cache.path)
        : Zotero.File.getContents(cache.path);
      if (text(raw)) return text(raw);
    }
  } catch (_) {}
  return "";
}

function fulltextSegments(raw: string, attachment: any, parentID?: number): SourceSegment[] {
  const title = itemTitle(attachment);
  const pageParts = raw.includes("\f") ? raw.split(/\f+/) : [];
  if (pageParts.filter((part) => text(part)).length > 1) {
    return pageParts
      .map((part, index) => ({ part: text(part), index }))
      .filter(({ part }) => !!part)
      .map(({ part, index }) => ({
        id: `pdf:${attachment.id}:page:${index + 1}`,
        kind: "fulltext" as const,
        title,
        text: part,
        itemID: parentID,
        attachmentID: Number(attachment.id),
        pageLabel: String(index + 1),
      }));
  }

  // Zotero's indexed PDF text does not always retain page boundaries. Preserve
  // honest section markers instead of inventing page numbers.
  const size = 6000;
  const overlap = 300;
  const segments: SourceSegment[] = [];
  for (let start = 0, chunk = 1; start < raw.length; start += size - overlap, chunk++) {
    const value = text(raw.slice(start, start + size));
    if (!value) continue;
    segments.push({
      id: `pdf:${attachment.id}:chunk:${chunk}`,
      kind: "fulltext",
      title,
      text: value,
      itemID: parentID,
      attachmentID: Number(attachment.id),
      chunk,
    });
  }
  return segments;
}

/** Extract metadata plus full text from every PDF/HTML child attachment. */
export async function getItemTextAsync(item: any): Promise<ItemText> {
  if (!item) return getItemText(item);
  let regular = item;
  if (item?.isAttachment?.() && item.parentItemID) {
    try {
      regular = (await Zotero.Items.getAsync(item.parentItemID)) || item;
    } catch (_) {}
  }
  const out = getItemText(regular);
  const attachmentIDs = item?.isAttachment?.()
    ? [item.id]
    : regular?.getAttachments?.() || [];
  const seen = new Set<number>();
  const full: string[] = [];
  for (const id of attachmentIDs) {
    const attachment = typeof id === "object" ? id : await Zotero.Items.getAsync(id);
    if (!attachment || seen.has(Number(attachment.id))) continue;
    seen.add(Number(attachment.id));
    const contentType = text(attachment.attachmentContentType).toLowerCase();
    if (!contentType.includes("pdf") && !contentType.includes("html") && !contentType.includes("text")) continue;
    const raw = await readAttachmentText(attachment);
    if (!raw) continue;
    full.push(raw);
    out.sources.push(...fulltextSegments(raw, attachment, out.itemID));
  }
  out.fullText = full.join("\n\n");
  return out;
}

function sourceLabel(source: SourceSegment): string {
  const location = source.pageLabel
    ? `第 ${source.pageLabel} 页`
    : source.chunk
      ? `全文片段 ${source.chunk}`
      : source.kind === "annotation"
        ? "批注"
        : source.kind === "note"
          ? "笔记"
          : "摘要";
  return `[来源：${source.title || "当前文献"}；${location}；source=${source.id}]`;
}

/** Build source-labelled context. Truncation happens on segment boundaries where possible. */
export function joinItemText(it: ItemText, limit = 50000): string {
  const parts: string[] = [];
  if (it.title) parts.push(`# ${it.title}`);
  const sources = it.sources?.length
    ? it.sources
    : [
        ...(it.abstract ? [{ id: "abstract", kind: "metadata" as const, title: it.title, text: it.abstract }] : []),
        ...(it.fullText ? [{ id: "fulltext", kind: "fulltext" as const, title: it.title, text: it.fullText }] : []),
      ];
  let used = parts.join("\n\n").length;
  for (const source of sources) {
    const marker = `${sourceLabel(source)}\n${source.text}`;
    if (used + marker.length > limit) {
      const remaining = limit - used;
      if (remaining > 400) parts.push(marker.slice(0, remaining) + "\n[上下文已截断]");
      break;
    }
    parts.push(marker);
    used += marker.length + 2;
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Build a compact context blob for the current library selection. */
export function describeItems(items: any[]): string {
  return items
    .map((item, index) => {
      const value = getItemText(item);
      return `【文献 ${index + 1}】${value.title}\n${value.abstract || ""}`.trim();
    })
    .join("\n\n");
}

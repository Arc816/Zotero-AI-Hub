// features/export.ts — export AI results as Zotero notes, Obsidian canvas, or .docx.
import { joinItemText, getItemText } from "./sources";

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal Markdown -> HTML (headings, bold, lists, paragraphs). */
export function mdToHtml(md: string): string {
  const lines = (md || "").split("\n");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (let line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
      continue;
    }
    closeList();
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const lvl = m[1].length;
      html += `<h${lvl}>${escapeHtml(m[2])}</h${lvl}>`;
      continue;
    }
    if (line.trim() === "") continue;
    html += `<p>${escapeHtml(line)}</p>`;
  }
  closeList();
  return html;
}

/** Create a child note under the given item (or standalone if no item). */
export async function resolveNoteParent(item: any): Promise<any> {
  let current = item;
  if (typeof current === "number" || typeof current === "string") {
    current = await Zotero.Items.getAsync(current);
  } else if (current?.id && typeof current?.isAttachment !== "function") {
    current = (await Zotero.Items.getAsync(current.id)) || current;
  }

  // Reader panes often receive the PDF attachment (and annotations point to
  // that attachment). Zotero only permits child notes below a regular item,
  // so walk upwards until the bibliographic parent is reached.
  const visited = new Set<number>();
  while (current?.id && !visited.has(Number(current.id))) {
    visited.add(Number(current.id));
    const nested = !!(
      current.isAttachment?.() ||
      current.isAnnotation?.() ||
      current.isNote?.()
    );
    if (!nested) return current;
    const parentID = current.parentItemID || current.parentID;
    if (!parentID) return null;
    current = await Zotero.Items.getAsync(parentID);
  }
  return current || null;
}

export async function createNoteForItem(
  item: any,
  title: string,
  content: string
): Promise<any> {
  const text = String(content || "").trim();
  if (!text) throw new Error("AI 结果为空，无法保存笔记");
  const parent = await resolveNoteParent(item);
  const note = new Zotero.Item("note");
  if (parent?.id) {
    if (parent.libraryID) note.libraryID = parent.libraryID;
    note.parentID = parent.id;
  }
  note.setNote(`<h1>${escapeHtml(title)}</h1>\n${mdToHtml(text)}`);
  await note.saveTx();
  return note;
}

/** Append AI output to an existing Zotero annotation comment. */
export async function appendToAnnotationComment(annotation: any, content: string): Promise<boolean> {
  if (!annotation || !annotation.id || !content.trim()) return false;
  try {
    const current = String(annotation.annotationComment || "").trim();
    annotation.annotationComment = `${current}${current ? "\n\n" : ""}AI Hub：${content.trim()}`;
    await annotation.saveTx();
    return true;
  } catch (error) {
    Zotero.debug("[AIHub] append annotation comment failed: " + error);
    return false;
  }
}

/** Build an Obsidian Canvas JSON string from items + a synthesized summary. */
export function buildObsidianCanvas(items: any[], summary: string): string {
  const nodes: any[] = [];
  const edges: any[] = [];
  const rootId = "root";
  nodes.push({
    id: rootId,
    type: "text",
    text: "# 文献综述\n\n" + summary,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  items.forEach((it, i) => {
    const t = getItemText(it);
    const id = `n${i}`;
    nodes.push({
      id,
      type: "text",
      text: `## ${t.title}\n\n${t.abstract || ""}`,
      x: 500,
      y: i * 320,
      width: 360,
      height: 280,
    });
    edges.push({ id: `e${i}`, fromNode: rootId, toNode: id });
  });
  return JSON.stringify({ nodes, edges }, null, 2);
}

// ---------- Dependency-free .docx via nsIZipWriter ----------

const DOCUMENT_XML = (title: string, content: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>
${mdToDocxXml(content)}
<w:sectPr/></w:body></w:document>`;

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mdToDocxXml(md: string): string {
  const lines = (md || "").split("\n");
  let xml = "";
  for (let line of lines) {
    const m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      xml += `<w:p><w:pPr><w:heading>${m[1].length}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
        m[2]
      )}</w:t></w:r></w:p>`;
      continue;
    }
    if (line.trim() === "") continue;
    xml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
  }
  return xml;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Build a real .docx file (OOXML zip) in the OS temp dir; returns the nsIFile. */
export function buildDocxFile(title: string, content: string): any {
  const file = Zotero.getTempDirectory();
  file.append((title || "aihub-export").replace(/[\\/:*?"<>|]/g, "_") + ".docx");
  if (file.exists()) file.remove(true);

  const zip = Components.classes["@mozilla.org/zipwriter;1"].createInstance(
    Components.interfaces.nsIZipWriter
  );
  zip.open(file, Components.interfaces.nsIZipWriter.OPEN_CREATE | Components.interfaces.nsIZipWriter.OPEN_TRUNCATED);

  const add = (path: string, data: string) => {
    const istream = Components.classes[
      "@mozilla.org/io/string-input-stream;1"
    ].createInstance(Components.interfaces.nsIStringInputStream);
    istream.setData(data, data.length);
    zip.addEntryStream(
      path,
      Date.now(),
      Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT,
      istream,
      false
    );
  };

  add("[Content_Types].xml", CONTENT_TYPES);
  add("_rels/.rels", RELS);
  add("word/document.xml", DOCUMENT_XML(title, content));
  zip.close();
  return file;
}

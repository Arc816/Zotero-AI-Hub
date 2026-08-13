// views/mindmapView.ts — render an outline into a simple SVG tree and open it.
import { logWarn } from "../../utils/logger";

interface Node {
  label: string;
  depth: number;
  children: Node[];
  x: number;
  y: number;
}

function parseOutline(text: string): Node | null {
  const lines = (text || "").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return null;
  const root: Node = { label: "ROOT", depth: -1, children: [], x: 0, y: 0 };
  const stack: Node[] = [root];
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1].length || 0;
    const depth = Math.floor(indent / 2);
    const label = line.replace(/^[\s\-*]+/, "").trim();
    if (!label) continue;
    const node: Node = { label, depth, children: [], x: 0, y: 0 };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children.length ? root : null;
}

function layout(root: Node, dx: number, dy: number): { w: number; h: number } {
  let cursor = 0;
  const visit = (n: Node): number => {
    n.x = n.depth * dx + 20;
    if (!n.children.length) {
      n.y = cursor * dy + 30;
      cursor++;
      return n.y;
    }
    const ys = n.children.map(visit);
    n.y = (ys[0] + ys[ys.length - 1]) / 2;
    return n.y;
  };
  const maxX = ((): number => {
    let m = 0;
    const dfs = (n: Node) => {
      m = Math.max(m, n.x);
      n.children.forEach(dfs);
    };
    root.children.forEach(dfs);
    return m;
  })();
  root.children.forEach(visit);
  return { w: maxX + 220, h: cursor * dy + 60 };
}

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toSvg(root: Node): string {
  const { w, h } = layout(root, 200, 46);
  const parts: string[] = [];
  const NODE_W = 180;
  const NODE_H = 30;
  const draw = (n: Node) => {
    const text = n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label;
    parts.push(
      `<rect x="${n.x}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="#e8f0fe" stroke="#4285f4"/>`
    );
    parts.push(
      `<text x="${n.x + 8}" y="${n.y + 5}" font-size="13" font-family="sans-serif">${escapeXml(
        text
      )}</text>`
    );
    for (const c of n.children) {
      parts.push(
        `<path d="M ${n.x + NODE_W} ${n.y} C ${n.x + NODE_W + 30} ${n.y}, ${
          c.x - 30
        } ${c.y}, ${c.x} ${c.y}" stroke="#90a4ae" fill="none"/>`
      );
      draw(c);
    }
  };
  root.children.forEach(draw);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join(
    ""
  )}</svg>`;
}

export function renderMindmapWindow(title: string, outline: string): void {
  try {
    const root = parseOutline(outline);
    const svg = root ? toSvg(root) : `<pre>${escapeXml(outline)}</pre>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeXml(
      title
    )} - 思维导图</title><style>body{font-family:sans-serif;background:#fff;margin:0}h2{padding:12px}</style></head><body><h2>${escapeXml(
      title
    )}</h2>${svg}</body></html>`;
    const file = Zotero.getTempDirectory();
    file.append("aihub-mindmap.html");
    if (file.exists()) file.remove(true);
    Zotero.File.putContents(file, html);
    Zotero.launchURL("file://" + file.path);
  } catch (e) {
    logWarn("renderMindmapWindow failed", e);
  }
}

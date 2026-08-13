// views/chat.ts — Q&A window logic (addon/content/chat.html).
import * as features from "../features";
import { joinItemText, getItemText } from "../features/sources";
import { rag } from "../features";
import { registry } from "../providers";
import { getPref } from "../config";
import { logWarn } from "../../utils/logger";

let winRef: any = null;

function $(id: string): any {
  return winRef.document.getElementById(id);
}

export function openChat(): void {
  try {
    // chrome:// URL — verified pattern in Zotero 9 (zotero-ai-butler).
    // Pass the main window as 4th arg so the window can read window.arguments[0].Zotero.
    const url = "chrome://aiHub/content/chat.html";
    Zotero.getMainWindow().openDialog(
      url,
      "aihub-chat",
      "chrome,width=560,height=680,resizable=yes",
      Zotero.getMainWindow()
    );
  } catch (e) {
    logWarn("openChat failed", e);
  }
}

export function onLoad(win: any): void {
  winRef = win;
  const ctx = currentContext();
  if (ctx) $("context").value = ctx.slice(0, 4000);
  $("send").addEventListener("click", send);
}

function currentContext(): string {
  try {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (items.length) return joinItemText(getItemText(items[0]));
  } catch {
    /* ignore */
  }
  return "";
}

async function send(): Promise<void> {
  const q = $("question").value;
  const ctx = $("context").value;
  const out = $("output");
  if (!q.trim()) return;
  if (!registry.default()) {
    out.value += "\n[未配置厂商，请先打开设置]\n";
    return;
  }
  out.value += `\n你: ${q}\nAI: `;
  out.scrollTop = out.scrollHeight;
  try {
    let contextToUse = ctx;
    if (getPref("rag.enabled") === true) {
      const scope = getPref("rag.scope") || "library";
      let itemIDs: any[] = [];
      if (scope === "selected" || scope === "current") {
        try {
          const selected = Zotero.getActiveZoteroPane().getSelectedItems();
          itemIDs = selected.map((item: any) => item?.parentItemID || item?.id).filter(Boolean);
          if (scope === "current") itemIDs = itemIDs.slice(0, 1);
        } catch (_) {}
      }
      const hits = await rag.search(q, parseInt(getPref("rag.topK")) || 5, itemIDs);
      if (hits.length) contextToUse = rag.formatHits(hits);
    }
    const answer = await features.chat(q, contextToUse, {});
    out.value += answer;
    out.scrollTop = out.scrollHeight;
  } catch (e: any) {
    out.value += `\n[错误] ${e?.message || e}\n`;
  }
  out.value += "\n";
}

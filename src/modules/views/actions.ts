// views/actions.ts — wiring between menu/UI events and AI features.
// Every action streams its result into the item-pane "AI 输出" panel (so the
// user sees output without hunting for notes) and also persists a child note.
import * as features from "../features";
import { joinItemText, getItemText, getItemTextAsync } from "../features/sources";
import { notify, createOverlay } from "./progress";
import { getString } from "../../utils/locale";
import { registry } from "../providers";
import { appendToAnnotationComment, buildDocxFile, createNoteForItem } from "../features/export";
import { renderMindmapWindow } from "./mindmapView";
import { newOutputBlock } from "./itemPane";
import { getPref } from "../config";
import { getTaskModel, TaskModelKind } from "../config";
import { isAbort } from "../errors";
import { CallOptions } from "../client";
import { CancellationSignal } from "../../utils/cancellation";

type StreamingRequest = {
  title: string;
  itemID?: any;
  providerId?: string;
  model?: string;
  question?: string;
  context?: string;
  actionKind?: string;
  signal?: CancellationSignal;
};

type StreamingCompletion = {
  saved: (noteItemID: any) => void;
};

export interface ActionOptions extends CallOptions {
  annotation?: any;
  pageLabel?: string;
  saveNote?: boolean;
}

function getSelectedItems(): any[] {
  try {
    return Zotero.getActiveZoteroPane().getSelectedItems();
  } catch {
    return [];
  }
}

function ensureProvider(): boolean {
  if (!registry.default()) {
    notify(getString("aihub.toast.noProvider"), "error");
    return false;
  }
  return true;
}

function taskOptions(task: TaskModelKind): ActionOptions {
  const choice = getTaskModel(task);
  return { providerId: choice.providerId || undefined, model: choice.model || undefined };
}

async function safeGetItem(id: any): Promise<any> {
  if (!id) return null;
  try {
    const item = await Zotero.Items.getAsync(id);
    if (item?.isAttachment?.() && item.parentItemID) {
      return (await Zotero.Items.getAsync(item.parentItemID)) || item;
    }
    return item;
  } catch {
    return { id };
  }
}

/**
 * Run an AI producer with streaming output to BOTH the item-pane panel and the
 * transient progress overlay. Returns the produced text, or null on error.
 */
async function runStreaming(
  request: string | StreamingRequest,
  producer: (onDelta: (t: string) => void) => Promise<string>,
  onComplete?: (text: string, output: StreamingCompletion) => Promise<void>
): Promise<string | null> {
  const title = typeof request === "string" ? request : request.title;
  const signal = typeof request === "string" ? undefined : request.signal;
  const block = newOutputBlock(request);
  const overlay = createOverlay(title);
  try {
    const text = await producer((d) => {
      if (signal?.aborted) return;
      block.append(d);
      overlay.setText(d);
    });
    if (signal?.aborted) {
      block.done("stopped");
      overlay.close();
      return null;
    }
    block.done("complete");
    if (onComplete) {
      try {
        await onComplete(text, { saved: block.saved });
      } catch (saveError: any) {
        const saveMessage = saveError?.message || String(saveError);
        block.done("error", saveMessage);
        notify("AI 回答已生成，但保存笔记失败：" + saveMessage, "error");
        throw saveError;
      }
    }
    overlay.close();
    return text;
  } catch (e: any) {
    if (isAbort(e) || e?.name === "AbortError" || /abort|取消/i.test(e?.message || "")) {
      block.done("stopped");
      overlay.close();
      return null;
    }
    const msg = e?.message || String(e);
    block.append("\n[出错] " + msg);
    block.done("error", msg);
    overlay.close();
    notify(getString("aihub.toast.error") + msg, "error");
    return null;
  }
}

async function maybeSaveNote(item: any, title: string, content: string, options: ActionOptions = {}): Promise<void> {
  if (options.saveNote === true || getPref("autoSaveNotes") === true) {
    await createNoteForItem(item, title, content);
    notify("已保存为 Zotero 子笔记", "success");
  }
}

export async function doSummary(): Promise<void> {
  const items = getSelectedItems();
  if (!items.length) return notify("请先选择一篇文献。", "error");
  if (!ensureProvider()) return;
  const options = taskOptions("summary");
  const text = await runStreaming({ title: getString("aihub.menu.summary"), itemID: items[0]?.id, actionKind: "summary", ...options }, (onDelta) =>
    features.summarizeItem(items[0], { onDelta, ...options })
  );
  if (text != null) {
    await maybeSaveNote(items[0], "AI 摘要", text);
  }
}

export async function doSummaryMulti(): Promise<void> {
  const items = getSelectedItems();
  if (items.length < 2) return notify("请选择至少两篇文献以生成多篇摘要。", "error");
  if (!ensureProvider()) return;
  const options = taskOptions("summary");
  const text = await runStreaming({ title: getString("aihub.menu.summaryMulti"), itemID: items[0]?.id, actionKind: "summaryMulti", ...options }, (onDelta) =>
    features.summarizeMulti(items, { onDelta, ...options })
  );
  if (text != null) {
    await maybeSaveNote(items[0], `AI 多篇摘要（${items.length}篇）`, text);
  }
}

export async function doReview(): Promise<void> {
  const items = getSelectedItems();
  if (items.length < 2) return notify("请选择至少两篇文献以生成综述。", "error");
  if (!ensureProvider()) return;
  const options = taskOptions("review");
  const text = await runStreaming({ title: getString("aihub.menu.review"), itemID: items[0]?.id, actionKind: "review", ...options }, (onDelta) =>
    features.reviewItems(items, { onDelta, ...options })
  );
  if (text != null) {
    await maybeSaveNote(items[0], `文献综述（${items.length}篇）`, text);
  }
}

export async function doTranslate(target = "English"): Promise<void> {
  const items = getSelectedItems();
  if (!items.length) return notify("请先选择文献。", "error");
  if (!ensureProvider()) return;
  const text = joinItemText(await getItemTextAsync(items[0]));
  if (!text.trim()) return notify("该文献没有可翻译的文本。", "error");
  const options = taskOptions("translate");
  const out = await runStreaming({ title: getString("aihub.menu.translate"), itemID: items[0]?.id, context: text, actionKind: "translate", ...options }, (onDelta) =>
    features.translate(text, target, { onDelta, ...options })
  );
  if (out != null) {
    await maybeSaveNote(items[0], `AI 翻译（${target}）`, out);
  }
}

export async function doMindmap(): Promise<void> {
  const items = getSelectedItems();
  if (!items.length) return notify("请先选择文献。", "error");
  if (!ensureProvider()) return;
  const text = joinItemText(await getItemTextAsync(items[0]));
  const outline = await runStreaming({ title: getString("aihub.menu.mindmap"), itemID: items[0]?.id, actionKind: "mindmap" }, (onDelta) =>
    features.mindmap(text, { onDelta })
  );
  if (outline != null) {
    renderMindmapWindow(items[0] ? getItemText(items[0]).title : "思维导图", outline);
  }
}

export async function doExportDocx(): Promise<void> {
  const items = getSelectedItems();
  if (!items.length) return notify("请先选择文献。", "error");
  if (!ensureProvider()) return;
  const text = await runStreaming({ title: getString("aihub.menu.export"), itemID: items[0]?.id, actionKind: "export" }, (onDelta) =>
    features.summarizeItem(items[0], { onDelta })
  );
  if (text != null) {
    const file = buildDocxFile(getItemText(items[0]).title || "ai-summary", text);
    notify("已导出 .docx：" + file.path, "success");
    try {
      file.reveal();
    } catch {
      /* ignore */
    }
  }
}

export async function doAnnotateFromItem(): Promise<void> {
  const items = getSelectedItems();
  if (!items.length) return notify("请先选择文献。", "error");
  const text = joinItemText(await getItemTextAsync(items[0]));
  return doAnnotate(text, items[0]);
}

export async function doAnnotate(selectedText: string, item: any, options: ActionOptions = {}): Promise<void> {
  if (!selectedText || !selectedText.trim()) return notify("请先在阅读器中选中文本。", "error");
  if (!ensureProvider()) return;
  const text = await runStreaming({ title: getString("aihub.menu.annotation"), itemID: item?.id, context: selectedText, actionKind: "annotate", signal: options.signal }, (onDelta) =>
    features.annotate(selectedText, { onDelta, ...options })
  );
  if (text != null) {
    const target = item || getSelectedItems()[0];
    if (options.annotation && await appendToAnnotationComment(options.annotation, text)) {
      notify("AI 内容已追加到当前 PDF 批注评论", "success");
    } else {
      const location = options.pageLabel ? `\n\n来源页码：${options.pageLabel}` : "";
      await maybeSaveNote(target, "AI 批注", `> ${selectedText}${location}\n\n${text}`, { ...options, saveNote: true });
    }
  }
}

/**
 * AI action triggered from the reader's text-selection popup.
 * @param kind  "annotate" | "summary" | "translate" | "chat"
 * @param text  the selected text
 * @param itemID the reader's item id (so we can attach a child note)
 */
export async function doSelectionAction(
  kind: string,
  text: string,
  itemID: any,
  options: ActionOptions = {}
): Promise<boolean> {
  if (!text || !text.trim()) return false;
  if (!ensureProvider()) return false;
  const item = await safeGetItem(itemID);
  const titles: Record<string, string> = {
    annotate: "AI 批注（选中）",
    summary: "AI 摘要（选中）",
    translate: "AI 翻译（选中）",
    chat: "AI 问答（选中）",
  };
  const title = titles[kind] || "AI 输出";
  const request = { title, itemID: item?.id || itemID, providerId: options.providerId, model: options.model, context: text, actionKind: kind, signal: options.signal };
  const produced = await runStreaming(request, (onDelta) => {
    if (kind === "annotate") return features.annotate(text, { onDelta, ...options });
    if (kind === "summary") return features.summarizeText(text, { onDelta, ...options });
    if (kind === "translate") return features.translate(text, "中文", { onDelta, ...options });
    if (kind === "chat")
      return features.chat("请解释并总结以下选中内容：\n" + text, text, { onDelta, ...options });
    return Promise.resolve("");
  });
  if (produced != null && item) {
    const body = kind === "annotate" ? `> ${text}\n\n${produced}` : produced;
    if (kind === "annotate" && options.annotation && await appendToAnnotationComment(options.annotation, produced)) {
      notify("AI 内容已追加到当前 PDF 批注评论", "success");
    } else {
      await maybeSaveNote(item, title, body, options);
    }
  }
  return produced != null;
}

/** Ask a custom question about the reader selection and stream into all AI panels. */
export async function doSelectionQuestion(
  question: string,
  context: string,
  itemID: any,
  options: ActionOptions = {}
): Promise<boolean> {
  if (!question.trim()) return false;
  if (!ensureProvider()) return false;
  const item = await safeGetItem(itemID);
  const produced = await runStreaming(
    { title: "AI 问答", itemID: item?.id || itemID, providerId: options.providerId, model: options.model, question, context, actionKind: "question", signal: options.signal },
    (onDelta) => features.chat(question, context || "（未提供选中文本）", { onDelta, ...options }),
    async (text, output) => {
      if (!item) throw new Error("无法定位当前文献，问答结果未能保存为笔记");
      const note = await createNoteForItem(item, "AI 问答", `## 问题\n${question}\n\n## 回答\n${text}`);
      output.saved(note?.id);
      notify("问答结果已保存为 Zotero 子笔记", "success");
    }
  );
  return produced != null;
}

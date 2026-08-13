/** Reader selection actions opening Zotero's native right content pane. */
import * as actions from "./actions";
import { openReaderPanel, removeReaderPanel } from "./readerPanel";

const PLUGIN_ID = "zotero-ai-hub@zoteroaihub";
let registered = false;

function selectedText(params: any): string {
  return String(
    params?.annotation?.text || params?.text || params?.annotation?.comment || ""
  ).trim();
}

function annotationItem(params: any): any {
  const id = params?.annotation?.id;
  if (!id) return null;
  try {
    return Zotero.Items.get(id) || null;
  } catch {
    return null;
  }
}

function currentReaderSelection(reader: any): string {
  try {
    const state = reader?._internalReader?._state;
    const popup = state?.primary
      ? state?.primaryViewSelectionPopup
      : state?.secondaryViewSelectionPopup || state?.primaryViewSelectionPopup;
    return String(popup?.annotation?.text || "").trim();
  } catch (_) {
    return "";
  }
}

function htmlButton(doc: any, label: string, primary = false): any {
  const element = doc.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = "toolbar-button wide-button aihub-reader-selection-button";
  element.style.cssText =
    "border:1px solid " +
    (primary ? "#1769d2" : "#c7cfd9") +
    ";border-radius:5px;background:" +
    (primary ? "#1769d2" : "var(--material-background, #fff)") +
    ";color:" +
    (primary ? "#fff" : "inherit") +
    ";padding:5px 8px;min-width:auto;cursor:pointer;font-size:12px;";
  return element;
}

function createSelectionActions(event: any): any {
  const { reader, doc, params } = event;
  const text = selectedText(params);
  if (!text) return null;

  const group = doc.createElement("div");
  group.className = "aihub-reader-selection-actions";
  group.style.cssText =
    "display:flex;align-items:center;gap:5px;flex-wrap:wrap;width:100%;padding:6px 2px 2px;box-sizing:border-box;border-top:1px solid rgba(127,127,127,.25);";

  const add = (label: string, kind?: string, primary = false) => {
    const element = htmlButton(doc, label, primary);
    element.addEventListener("click", (clickEvent: any) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      openReaderPanel(reader, text, doc);
      if (kind === "ask") return;
      if (kind) void actions.doSelectionAction(kind, text, reader?.itemID, {
        annotation: annotationItem(params),
        pageLabel: params?.annotation?.pageLabel,
      });
    });
    group.appendChild(element);
  };

  add("AI 助手", undefined, true);
  add("摘要", "summary");
  add("智能批注", "annotate");
  add("译为中文", "translate");
  add("问答", "ask");
  return group;
}

function createAnnotationHeaderAction(event: any): any | null {
  const { reader, doc, params } = event;
  const data = params?.annotation;
  const selected = String(data?.text || "").trim();
  if (!selected || !data?.id) return null;
  const button = htmlButton(doc, "AI 批注", false);
  button.title = "生成 AI 评论并追加到这个 Zotero PDF 批注";
  button.addEventListener("click", () => {
    const annotation = annotationItem(params);
    openReaderPanel(reader, selected, doc);
    void actions.doSelectionAction("annotate", selected, reader?.itemID, {
      annotation,
      pageLabel: data?.pageLabel,
    });
  });
  return button;
}

function createNativeContextItem(reader: any): any | null {
  const text = currentReaderSelection(reader);
  if (!text) return null;
  const run = (kind?: string) => () => {
    openReaderPanel(reader, text);
    if (kind) void actions.doSelectionAction(kind, text, reader?.itemID);
  };
  return {
    label: "Zotero AI Hub",
    groups: [[
      { label: "打开右侧 AI 助手", disabled: false, onCommand: run() },
      { label: "AI 摘要（选中）", disabled: false, onCommand: run("summary") },
      { label: "AI 智能批注（选中）", disabled: false, onCommand: run("annotate") },
      { label: "AI 译为中文（选中）", disabled: false, onCommand: run("translate") },
      { label: "基于选中内容问答", disabled: false, onCommand: run() },
    ]],
  };
}

function removeLegacyToolbarControls(): void {
  setTimeout(() => {
    try {
      const readers: any[] = (Zotero as any).Reader?._readers || [];
      for (const reader of readers) {
        const doc = reader?._iframeWindow?.document;
        doc?.getElementById?.("aihub-reader-toolbar")?.remove();
      }
    } catch (error: any) {
      Zotero.debug("[AIHub] remove legacy reader toolbar control failed: " + (error?.stack || error));
    }
  }, 0);
}

export function registerReaderMenu(): void {
  if (registered) return;
  try {
    const Reader: any = (Zotero as any).Reader;
    if (!Reader || typeof Reader.registerEventListener !== "function") {
      Zotero.debug("[AIHub] Reader event API unavailable; skipping reader integration.");
      return;
    }

    Reader.registerEventListener(
      "renderTextSelectionPopup",
      (event: any) => {
        try {
          const actionsElement = createSelectionActions(event);
          if (actionsElement) event.append(actionsElement);
        } catch (error: any) {
          Zotero.debug("[AIHub] renderTextSelectionPopup failed: " + (error?.stack || error));
        }
      },
      PLUGIN_ID
    );

    // Existing saved highlights have stable Zotero annotation IDs. Writing the
    // result to their comment is supported and keeps page/position provenance.
    Reader.registerEventListener(
      "renderSidebarAnnotationHeader",
      (event: any) => {
        try {
          const button = createAnnotationHeaderAction(event);
          if (button) event.append(button);
        } catch (error: any) {
          Zotero.debug("[AIHub] renderSidebarAnnotationHeader failed: " + (error?.stack || error));
        }
      },
      PLUGIN_ID
    );

    // Zotero's native PDF/EPUB right-click menu is built through this event.
    // It is separate from renderTextSelectionPopup, so register both paths.
    Reader.registerEventListener(
      "createViewContextMenu",
      (event: any) => {
        try {
          const item = createNativeContextItem(event.reader);
          if (item) event.append(item);
        } catch (error: any) {
          Zotero.debug("[AIHub] createViewContextMenu failed: " + (error?.stack || error));
        }
      },
      PLUGIN_ID
    );

    registered = true;
    removeLegacyToolbarControls();
    Zotero.debug("[AIHub] reader selection actions and native right workspace registered.");
  } catch (error: any) {
    Zotero.debug("[AIHub] registerReaderMenu failed: " + (error?.stack || error));
  }
}

export function unregisterReaderMenu(): void {
  try {
    const Reader: any = (Zotero as any).Reader;
    const readers: any[] = Reader?._readers || [];
    for (const reader of readers) {
      const doc = reader?._iframeWindow?.document;
      doc?.getElementById?.("aihub-reader-toolbar")?.remove();
      removeReaderPanel(reader);
    }
    Reader?._unregisterEventListenerByPluginID?.(PLUGIN_ID);
  } catch (_) {
    // Reader documents may already be destroyed during Zotero shutdown.
  }
  registered = false;
}

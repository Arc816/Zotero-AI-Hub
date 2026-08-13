// views/contextMenu.ts - grouped AI actions in Zotero's item context menu.
import { getString } from "../../utils/locale";
import { logWarn } from "../../utils/logger";
import * as actions from "./actions";
import { openDashboard } from "./dashboard";
import { openChat } from "./chat";
import { openAIHubPane } from "./itemPane";

const ROOT_ID = "aihub-context-menu-root";
const POPUP_HANDLER_KEY = "__aihubPopupHandler";
const LEGACY_IDS = [
  "aihub-summary",
  "aihub-summary-multi",
  "aihub-review",
  "aihub-translate",
  "aihub-mindmap",
  "aihub-export",
  "aihub-dashboard",
];

const ITEM_MENU_ENTRIES: { id: string; label: string; fn: () => any }[] = [
  { id: "aihub-summary", label: getString("aihub.menu.summary"), fn: () => actions.doSummary() },
  { id: "aihub-summary-multi", label: getString("aihub.menu.summaryMulti"), fn: () => actions.doSummaryMulti() },
  { id: "aihub-annotation", label: getString("aihub.menu.annotation"), fn: () => actions.doAnnotateFromItem() },
  { id: "aihub-chat", label: getString("aihub.menu.chat"), fn: () => openChat() },
  { id: "aihub-review", label: getString("aihub.menu.review"), fn: () => actions.doReview() },
  { id: "aihub-translate", label: getString("aihub.menu.translate"), fn: () => actions.doTranslate() },
  { id: "aihub-mindmap", label: getString("aihub.menu.mindmap"), fn: () => actions.doMindmap() },
  { id: "aihub-export", label: getString("aihub.menu.export"), fn: () => actions.doExportDocx() },
];

function runMenuAction(entry: (typeof ITEM_MENU_ENTRIES)[number]): void {
  try {
    const result = entry.fn();
    if (result && typeof result.catch === "function") {
      result.catch((error: any) => logWarn("context action " + entry.id, error));
    }
  } catch (error) {
    logWarn("context action " + entry.id, error);
  }
}

function removeLegacyItems(doc: any): void {
  const host = doc.getElementById("zotero-itemmenu");
  if (!host) return;
  for (const id of LEGACY_IDS) {
    const element = doc.getElementById(id);
    if (element?.parentNode === host) element.remove();
  }
}

function injectMenuItems(doc: any): void {
  const host = doc.getElementById("zotero-itemmenu");
  if (!host) return;
  if (doc.getElementById(ROOT_ID)) return;
  removeLegacyItems(doc);

  const root = doc.createXULElement("menu");
  root.id = ROOT_ID;
  root.setAttribute("label", "Zotero AI Hub");
  root.setAttribute("class", "menu-iconic");

  const popup = doc.createXULElement("menupopup");
  for (const entry of ITEM_MENU_ENTRIES) {
    const item = doc.createXULElement("menuitem");
    item.id = entry.id;
    item.setAttribute("label", entry.label);
    item.addEventListener("command", () => runMenuAction(entry));
    popup.appendChild(item);
  }

  popup.appendChild(doc.createXULElement("menuseparator"));
  const workspace = doc.createXULElement("menuitem");
  workspace.id = "aihub-open-workspace";
  workspace.setAttribute("label", "打开右侧 AI Hub");
  workspace.addEventListener("command", () => void openAIHubPane());
  popup.appendChild(workspace);
  const settings = doc.createXULElement("menuitem");
  settings.id = "aihub-dashboard";
  settings.setAttribute("label", getString("aihub.menu.openDashboard"));
  settings.addEventListener("command", openDashboard);
  popup.appendChild(settings);

  root.appendChild(popup);
  host.appendChild(root);
}

function attachPopupHandler(win: any): void {
  const menu = win.document.getElementById("zotero-itemmenu");
  if (!menu || (menu as any)[POPUP_HANDLER_KEY]) return;
  const handler = () => injectMenuItems(win.document);
  (menu as any)[POPUP_HANDLER_KEY] = handler;
  menu.addEventListener("popupshowing", handler);
}

export function registerContextMenu(win: any): void {
  if (!win?.document) return;
  injectMenuItems(win.document);
  attachPopupHandler(win);
}

export function unregisterContextMenu(win: any): void {
  try {
    const doc = win?.document;
    if (!doc) return;
    doc.getElementById(ROOT_ID)?.remove();
    removeLegacyItems(doc);
    const menu = doc.getElementById("zotero-itemmenu");
    const handler = menu && (menu as any)[POPUP_HANDLER_KEY];
    if (menu && handler) {
      menu.removeEventListener("popupshowing", handler);
      delete (menu as any)[POPUP_HANDLER_KEY];
    }
  } catch (error) {
    logWarn("unregisterContextMenu", error);
  }
}

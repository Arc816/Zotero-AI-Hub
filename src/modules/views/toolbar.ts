// views/toolbar.ts — add AI action buttons to the main library toolbar.
import { getString } from "../../utils/locale";
import * as actions from "./actions";
import { openDashboard } from "./dashboard";
import { openChat } from "./chat";
import { openAIHubPane } from "./itemPane";

export function registerToolbar(win: any): void {
  const doc = win.document;
  const tb = doc.getElementById("zotero-tb");
  if (!tb) return;
  const make = (id: string, label: string, fn: () => void) => {
    if (doc.getElementById(id)) return;
    const b = doc.createXULElement("toolbarbutton");
    b.id = id;
    b.setAttribute("label", label);
    b.setAttribute("class", "toolbarbutton-1");
    b.addEventListener("command", fn);
    tb.appendChild(b);
  };
  make("aihub-workspace-btn", "Zotero AI Hub", () => void openAIHubPane());
  make("aihub-summary-btn", getString("aihub.menu.summary"), () => actions.doSummary());
  make("aihub-chat-btn", getString("aihub.menu.chat"), () => openChat());
  make("aihub-anno-btn", getString("aihub.menu.annotation"), () => actions.doAnnotateFromItem());
  make("aihub-settings-btn", getString("aihub.menu.openDashboard"), () => openDashboard());
}

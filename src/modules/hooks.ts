// modules/hooks.ts — Zotero lifecycle hooks (the plugin's spine).
import { registry } from "./providers";
import { registerContextMenu, unregisterContextMenu } from "./views/contextMenu";
import { registerToolbar } from "./views/toolbar";
import { registerItemPane, registerItemPaneWindow, unregisterItemPane } from "./views/itemPane";
import { registerReaderMenu, unregisterReaderMenu } from "./views/readerMenu";
import { startMcp, stopMcp } from "./mcp/server";
import { getPref, getProviders, addPrefObserver, saveProviders, flushPrefs, setPref } from "./config";
import { logInfo, logWarn } from "../utils/logger";
import { migrateModelCatalog } from "./modelCatalog";
import { initializeCredentialStore, migrateProviderCredentials, setNamedSecret } from "./credentialStore";

function restartMcpIfEnabled(): void {
  try {
    stopMcp();
    if (getPref("mcp.enabled") !== false) startMcp();
  } catch (e) {
    logWarn("restartMcpIfEnabled", e);
  }
}

export const hooks = {
  async onStartup(payload: { id: string; version: string; rootURI: string }): Promise<void> {
    Zotero.AIHub = Zotero.AIHub || ({} as any);
    Zotero.AIHub.hooks = hooks;
    // Persist rootURI for windows/dashboard to load via jar: paths (more robust than chrome:// in Zotero 9).
    Zotero.AIHub.rootURI = payload?.rootURI || "";
    await initializeCredentialStore();
    // One-time migration: saveProviders/setPref move legacy plaintext secrets
    // to Zotero's encrypted Login Manager and blank the ordinary prefs.
    const legacyProviders = getProviders();
    if (legacyProviders.some((provider) => provider.apiKey || provider.apiSecret)) {
      await migrateProviderCredentials(legacyProviders);
      saveProviders(legacyProviders);
      const ragKey = getPref("rag.embeddingKey");
      if (ragKey) {
        await setNamedSecret("rag:embeddingKey", ragKey);
        setPref("rag.embeddingKey", ragKey);
      }
      flushPrefs();
    }
    migrateModelCatalog();
    registry.load();
    logInfo(`AI Hub ${payload?.version || ""} 启动`);

    // Like Translate for Zotero, define the window-local XUL custom element
    // before ItemPaneManager instantiates the section body.
    try {
      const wins: any[] = (Zotero.getMainWindows && Zotero.getMainWindows()) || [];
      for (const w of wins) registerItemPaneWindow(w);
    } catch (e) {
      logWarn("startup item-pane custom element", e);
    }

    // Register the visible AI output panel (right-hand item pane) and the
    // reader text-selection menu. These use global Zotero 9 APIs, so they are
    // registered once at startup (not per main window).
    registerItemPane();
    registerReaderMenu();

    // If the main window is already open (e.g. plugin installed while Zotero
    // is running), Zotero may not call onMainWindowLoad for it. Register the
    // menu/toolbar for every currently-open main window too. (Matches the
    // pattern used by zotero-ai-butler / translate-for-zotero.)
    try {
      const wins: any[] = (Zotero.getMainWindows && Zotero.getMainWindows()) || [];
      for (const w of wins) {
        try {
          w.MozXULElement?.insertFTLIfNeeded?.("aiHub.ftl");
          registerItemPaneWindow(w);
          registerContextMenu(w);
          registerToolbar(w);
        } catch (e) {
          logWarn("startup register on open window", e);
        }
      }
    } catch (e) {
      logWarn("getMainWindows", e);
    }

    // If the main window DOM isn't ready yet, poll until the menus exist and
    // then inject. This covers the common case where onStartup runs before the
    // item menu has been constructed.
    try {
      let attempts = 0;
      if (typeof setInterval !== "function") return;
      const id = setInterval(() => {
        attempts++;
        try {
          const wins: any[] = (Zotero.getMainWindows && Zotero.getMainWindows()) || [];
          let any = false;
          for (const w of wins) {
            const menu = w.document.getElementById("zotero-itemmenu");
            if (menu) {
              registerItemPaneWindow(w);
              registerContextMenu(w);
              registerToolbar(w);
              any = true;
            }
          }
          if (any || attempts >= 40) {
            try { clearInterval(id); } catch {}
          }
        } catch (e) {
          logWarn("context menu poll", e);
        }
      }, 250) as any;
    } catch (e) {
      logWarn("menu polling setup", e);
    }

    // Register preference pane (opens the HTML dashboard).
    // In Zotero 9 the XUL pane must use rootURI + defaultXUL:true; chrome:// mapping may not resolve.
    try {
      const rootURI = Zotero.AIHub.rootURI;
      Zotero.PreferencePanes.register({
        pluginID: "zotero-ai-hub@zoteroaihub",
        src: rootURI + "addon/content/preferences.xhtml",
        label: "AI Hub",
        defaultXUL: true,
        scripts: [rootURI + "addon/content/scripts/preferences.js"],
      });
    } catch (e) {
      logWarn("PreferencePanes.register", e);
    }

    if (getPref("mcp.enabled") !== false) startMcp();
    addPrefObserver("mcp.port", restartMcpIfEnabled);
    addPrefObserver("mcp.enabled", restartMcpIfEnabled);
    addPrefObserver("mcp.allowRemote", restartMcpIfEnabled);
  },

  onMainWindowLoad(win: any): void {
    try {
      win.MozXULElement?.insertFTLIfNeeded?.("aiHub.ftl");
      registerItemPaneWindow(win);
      registerContextMenu(win);
      registerToolbar(win);
    } catch (e) {
      logWarn("onMainWindowLoad", e);
    }
  },

  onMainWindowUnload(win: any): void {
    unregisterContextMenu(win);
  },

  async onShutdown(_reason: any): Promise<void> {
    stopMcp();
    unregisterReaderMenu();
    unregisterItemPane();
    try {
      const wins: any[] = (Zotero.getMainWindows && Zotero.getMainWindows()) || [];
      for (const win of wins) unregisterContextMenu(win);
    } catch (e) {
      logWarn("shutdown context-menu cleanup", e);
    }
  },
};

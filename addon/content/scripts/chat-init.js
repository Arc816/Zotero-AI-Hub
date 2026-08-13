// chat-init.js — standalone init for chat.html (chrome:// window).
// Same rationale as dashboard-init.js: external script (no inline CDATA),
// defer to window.onload, and expose Zotero from window.arguments[0]
// (the main window passed by openChat()).
(function () {
  "use strict";

  function getMainWindow() {
    try {
      if (window.arguments && window.arguments[0]) {
        var arg = window.arguments[0];
        if (arg.Zotero) return arg;
        if (arg.window && arg.window.Zotero) return arg.window;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  var mainWin = getMainWindow();
  if (!mainWin) {
    Zotero.debug("[AIHub] chat-init.js: no main window in arguments");
  } else {
    try {
      if (typeof Zotero === "undefined") {
        window.Zotero = mainWin.Zotero;
      }
      if (typeof openDialog === "undefined" && typeof mainWin.openDialog === "function") {
        window.openDialog = mainWin.openDialog.bind(mainWin);
      }
      window.__aihubMainWindow = mainWin;
    } catch (e) {
      Zotero.debug("[AIHub] chat-init.js: inject failed: " + e);
    }
  }

  var init = function () {
    try {
      if (window.__aihubChatInit) return;
      window.__aihubChatInit = true;
      Zotero.debug("[AIHub] chat-init.js: init chat");
      if (Zotero && Zotero.AIHub && Zotero.AIHub.views && Zotero.AIHub.views.chat) {
        Zotero.AIHub.views.chat.onLoad(window);
      } else {
        Zotero.debug("[AIHub] chat-init.js: Zotero.AIHub.views.chat not found");
      }
    } catch (e) {
      Zotero.debug("[AIHub] chat-init.js init failed: " + e);
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    window.addEventListener("load", init);
  }
})();

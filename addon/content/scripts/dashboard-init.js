// dashboard-init.js — standalone init for dashboard.html (chrome:// window).
//
// IMPORTANT: Zotero 9 loads chrome:// HTML windows in text/html mode, so an
// inline <script><![CDATA[ ... ]]></script> dies with
//   SyntaxError: expected expression, got '<'
// Use an external script instead (this file), and defer init to window.onload.
//
// Also IMPORTANT: a standalone chrome:// window has its own global scope and
// NO `Zotero` global. openDashboard() passes the Zotero main window as the
// 4th openDialog argument; we read it from window.arguments[0] and expose its
// `Zotero` (and openDialog) as globals here, mirroring zotero-ai-butler.
(function () {
  "use strict";

  function getMainWindow() {
    try {
      if (window.arguments && window.arguments[0]) {
        var arg = window.arguments[0];
        // Could be the main window itself, or an object wrapping it.
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
    Zotero.debug("[AIHub] dashboard-init.js: no main window in arguments");
  } else {
    try {
      if (typeof Zotero === "undefined") {
        // Inject the real Zotero global into this window's scope.
        window.Zotero = mainWin.Zotero;
      }
      if (typeof openDialog === "undefined" && typeof mainWin.openDialog === "function") {
        window.openDialog = mainWin.openDialog.bind(mainWin);
      }
      // Remember the main window for later (e.g. Zotero.getMainWindow() calls).
      window.__aihubMainWindow = mainWin;
    } catch (e) {
      Zotero.debug("[AIHub] dashboard-init.js: inject failed: " + e);
    }
  }

  var init = function () {
    try {
      if (window.__aihubDashboardInit) return;
      window.__aihubDashboardInit = true;
      Zotero.debug("[AIHub] dashboard-init.js: init dashboard");
      if (Zotero && Zotero.AIHub && Zotero.AIHub.views && Zotero.AIHub.views.dashboard) {
        Zotero.AIHub.views.dashboard.onLoad(window);
      } else {
        Zotero.debug("[AIHub] dashboard-init.js: Zotero.AIHub.views.dashboard not found");
      }
    } catch (e) {
      Zotero.debug("[AIHub] dashboard-init.js init failed: " + e);
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    window.addEventListener("load", init);
  }
})();

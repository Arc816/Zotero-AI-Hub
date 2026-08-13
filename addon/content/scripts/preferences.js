// preferences.js — loaded via PreferencePanes.register scripts[].
// Attaches the dashboard button handler by id, with retry until the button
// exists (Zotero 9 can load this script before the pane DOM is ready).
(function () {
  "use strict";

  function bind() {
    try {
      Zotero.debug("[AIHub] preferences.js executed");
      var button = document.getElementById("aiHub-openDashboard");
      if (!button) {
        Zotero.debug("[AIHub] Button #aiHub-openDashboard not found, retrying");
        return false;
      }
      button.addEventListener("click", function () {
        try {
          Zotero.debug("[AIHub] Dashboard button clicked");
          var dashboard = Zotero && Zotero.AIHub && Zotero.AIHub.views && Zotero.AIHub.views.dashboard;
          if (dashboard && typeof dashboard.openDashboard === "function") {
            dashboard.openDashboard();
          } else {
            // Fallback: open the chrome:// window directly, no module needed.
            Zotero.getMainWindow().openDialog(
              "chrome://aiHub/content/dashboard.html",
              "aihub-dashboard",
              "chrome,width=900,height=740,resizable=yes"
            );
          }
        } catch (e) {
          Zotero.debug("[AIHub] Dashboard button error: " + e);
        }
      });
      Zotero.debug("[AIHub] Dashboard button listener attached");
      return true;
    } catch (e) {
      Zotero.debug("[AIHub] Fatal error in preferences.js: " + e);
      return false;
    }
  }

  if (bind()) return;

  // Pane DOM may not be ready yet — retry a few times on DOMContentLoaded/intervals.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (bind() || tries >= 10) clearInterval(iv);
  }, 200);
  document.addEventListener("DOMContentLoaded", function () {
    if (bind()) clearInterval(iv);
  });
})();

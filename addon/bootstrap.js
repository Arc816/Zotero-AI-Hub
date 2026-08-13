// zotero-ai-hub bootstrap.js
// Bootstrapped addon entry: register chrome mapping, load the esbuild bundle,
// then drive the plugin lifecycle through Zotero.AIHub.hooks.
var chromeHandle = null;
var rootURIRef = null;

function install() {}

async function startup({ id, version, rootURI }, reason) {
  if (typeof Zotero === "undefined" || !Zotero) {
    return;
  }
  rootURIRef = rootURI;

  try {
    const aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    const manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "aiHub", rootURI + "addon/content/"],
    ]);
  } catch (e) {
    Zotero.debug("[AIHub] registerChrome failed: " + e);
  }

  // Load the bundled IIFE into the bootstrap global scope so it can see
  // Zotero / Components / Services as globals.
  Services.scriptloader.loadSubScript(
    rootURI + "addon/content/scripts/aiHub.js"
  );

  await Zotero.AIHub.hooks.onStartup({ id, version, rootURI });
}

async function shutdown({ reason }, win) {
  if (!Zotero.AIHub || !Zotero.AIHub.hooks) return;
  await Zotero.AIHub.hooks.onShutdown(reason);
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}

// Zotero 9 main-window lifecycle hooks (delegated to the bundle).
// IMPORTANT: Zotero 9 passes a { window, ... } wrapper object, NOT a bare
// window. The old `onMainWindowLoad(win)` signature received the wrapper, so
// `win.document` was undefined and registerContextMenu silently failed —
// which is why the right-click AI menu never appeared. Destructure { window }.
async function onMainWindowLoad({ window }, reason) {
  if (Zotero && Zotero.AIHub && Zotero.AIHub.hooks) {
    Zotero.AIHub.hooks.onMainWindowLoad(window);
  }
}

async function onMainWindowUnload({ window }, reason) {
  if (Zotero && Zotero.AIHub && Zotero.AIHub.hooks) {
    Zotero.AIHub.hooks.onMainWindowUnload(window);
  }
}

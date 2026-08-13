"use strict";

// Loaded into every Zotero main window, matching Translate for Zotero's
// custom-element architecture. The bundled plugin owns the AI state and this
// thin window-local element only mounts it into Zotero's native item section.
(() => {
  const TAG = "aihub-workspace-panel";
  if (customElements.get(TAG)) return;

  class AIHubWorkspacePanel extends XULElementBase {
    _item = null;
    sectionBody = null;
    setSectionSummary = null;

    get item() {
      return this._item;
    }

    set item(value) {
      this._item = value;
    }

    get content() {
      const rootURI = String(Zotero.AIHub?.rootURI || "");
      return MozXULElement.parseXULToFragment(`
        <linkset>
          <html:link rel="stylesheet" href="${rootURI}addon/content/aiHubPane.css"></html:link>
        </linkset>
        <html:div class="aihub-workspace-mount"></html:div>
      `);
    }

    connectedCallback() {
      Zotero.UIProperties.registerRoot(this);
      super.connectedCallback();
      // If ItemPaneManager rendered before this per-window script finished
      // loading, the expando properties set by onRender survive the custom
      // element upgrade. Render them immediately after connection.
      this.render();
    }

    init() {}

    render() {
      const mount = this.querySelector(".aihub-workspace-mount");
      Zotero.AIHub?.itemPaneBridge?.render?.({
        panel: this,
        mount,
        item: this._item,
        sectionBody: this.sectionBody,
        setSectionSummary: this.setSectionSummary,
      });
    }

    destroy() {
      const mount = this.querySelector(".aihub-workspace-mount");
      Zotero.AIHub?.itemPaneBridge?.destroy?.({ panel: this, mount });
    }
  }

  customElements.define(TAG, AIHubWorkspacePanel);
})();

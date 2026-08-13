/** Compatibility adapter: reader actions now use Zotero's native right content pane. */
import { openAIHubPane, setReaderContext, toggleAIHubPane } from "./itemPane";

export function ensureReaderPanel(_reader: any, _doc?: any): void {
  // ItemPaneManager creates one native section for each Zotero reader context.
}

export function openReaderPanel(reader: any, selectedText = "", _doc?: any): void {
  setReaderContext(selectedText, reader?.itemID);
  void openAIHubPane(selectedText, reader?.itemID);
}

export function toggleReaderPanel(_reader: any, _doc?: any): void {
  toggleAIHubPane();
}

export function removeReaderPanel(_reader: any): void {
  // No custom DOM is injected into reader documents anymore.
}

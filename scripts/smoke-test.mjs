import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const update = JSON.parse(read("update.json"));
assert(manifest.version === pkg.version, "manifest/package version mismatch");
assert(update.addons?.["zotero-ai-hub@zoteroaihub"]?.updates?.[0]?.version === manifest.version, "update version mismatch");

const ftl = read("locale/zh-CN/aiHub.ftl");
assert(/aihub-pane-header\s*=\s*\n\s+\.label\s*=/.test(ftl), "item pane header must use a .label Fluent attribute");
const headerLine = ftl.split(/\r?\n/).find((line) => line.startsWith("aihub-pane-header")) || "";
assert(/^aihub-pane-header\s*=\s*$/.test(headerLine), "item pane header must not have a Fluent value that replaces native children");

const pane = read("src/modules/views/itemPane.ts");
assert(pane.includes('bodyXHTML: `<${PANEL_TAG} />`'), "item pane custom body missing");
assert(!pane.includes("latestReaderItemID === item?.id || item?.id"), "cross-document context regression detected");
assert(pane.includes('data-aihub="stop"'), "stop-generation control missing");
assert(pane.includes('data-output-act="delete"'), "per-output delete control missing");
assert(pane.includes('data-output-act="expand"'), "long output expand/collapse control missing");
assert(pane.includes("data-aihub-output-count"), "output character count missing");
assert(pane.includes("[...history].reverse().map(blockMarkup)"), "newest output must render first");
assert(pane.includes("prependHTML(host, blockMarkup(block))"), "new streaming output must appear at the top");
assert(pane.includes("revealOutputCard"), "new output must be scrolled into view");
assert(pane.includes("historyKey(existingHost.itemID) === historyKey(nextItemID)"), "same-item Zotero notifier renders must preserve the live pane");
const quickAnalysisIndex = pane.indexOf(">快速分析<");
const contextIndex = pane.indexOf('data-aihub="context"');
assert(quickAnalysisIndex >= 0 && quickAnalysisIndex < contextIndex, "quick analysis must be visible before the context editor");
assert(pane.includes('data-aihub="context" rows="4"'), "context editor must stay compact in the first viewport");

const readerMenu = read("src/modules/views/readerMenu.ts");
assert(!readerMenu.includes('"renderToolbar"'), "legacy blue reader toolbar button must not be registered");
assert(!readerMenu.includes("createToolbarControl"), "legacy reader toolbar factory must be removed");

const providers = read("src/modules/providers/index.ts");
assert(providers.includes("if (isAbort(e)) throw e"), "abort must not trigger provider failover");
assert(providers.includes("p === primary && opts.model"), "fallback must not reuse another provider's model");

const dashboard = read("src/modules/views/dashboard.ts");
assert(!dashboard.includes("providers pref ="), "provider credentials must not be dumped to debug logs");

const actions = read("src/modules/views/actions.ts");
assert(actions.includes("if (signal?.aborted) return;"), "late stream deltas must be ignored after cancellation");
assert(actions.includes('block.done("stopped")'), "cancelled output cards must remain stopped");
assert(actions.includes("问答结果已保存为 Zotero 子笔记"), "Q&A must save a child note after completion");

const exporter = read("src/modules/features/export.ts");
assert(exporter.includes("resolveNoteParent"), "note save must resolve attachments to their parent item");
assert(exporter.includes("current.isAttachment?.()"), "attachment note-parent handling missing");

const sessions = read("src/modules/sessions.ts");
assert(sessions.includes("Zotero.DataDirectory.dir"), "session history must use Zotero's active data directory");

const credentials = read("src/modules/credentialStore.ts");
assert(credentials.includes("Services?.logins"), "secure credential store must use Zotero/Firefox Login Manager");
const config = read("src/modules/config.ts");
assert(config.includes("secureProviders(list)"), "provider preferences must be redacted before persistence");

const sources = read("src/modules/features/sources.ts");
assert(sources.includes("attachmentText"), "PDF attachment full-text extraction missing");
assert(sources.includes("getItemContent"), "Zotero Fulltext fallback missing");

const rag = read("src/modules/features/rag.ts");
assert(rag.includes("existing.filter"), "RAG index must preserve unrelated documents during incremental updates");
assert(rag.includes("signal?: CancellationSignal"), "RAG search must be cancellable");

const http = read("src/utils/http.ts");
assert(http.includes("xmlhttp?.abort?.()"), "stream cancellation must explicitly abort the underlying XHR");
assert(!http.includes("signal: opts.signal"), "custom cancellation signal must not be passed to Zotero.HTTP.request");
assert(http.includes("sseBuffer.match(/\\r?\\n\\r?\\n/)"), "SSE parser must support CRLF event separators");
assert(http.includes('new AIHubError("ABORTED"'), "stream cancellation must wake pending generators with ABORTED");
assert(pane.includes('setHostStatus(host, "已停止，可重新发送"'), "stop must immediately restore an actionable pane state");
assert(pane.includes("rawContext.slice(0, 32000)"), "Q&A must cap oversized context to reduce first-token latency");
assert(pane.includes("createCancellationController()"), "Zotero-compatible cancellation controller must be used");
assert(!pane.includes("new AbortController()"), "browser AbortController is unavailable in the Zotero sandbox");
assert(pane.includes("launchHostTask(host"), "click handlers must surface pre-request failures");

console.log("[smoke] manifest, Fluent, item pane, cancellation, routing, and credential logging checks passed");

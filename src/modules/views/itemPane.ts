/** Zotero-native right content-pane workspace shared by the library and readers. */
import {
  flushPrefs,
  getPref,
  getProviders,
  saveProviders,
  saveTaskModel,
  setPref,
} from "../config";
import { knownModels } from "../modelCatalog";
import { registry } from "../providers";
import * as actions from "./actions";
import { openDashboard } from "./dashboard";
import { getItemTextAsync, joinItemText } from "../features/sources";
import { createNoteForItem } from "../features/export";
import { sessions, SessionEntry } from "../sessions";
import { rag } from "../features";
import {
  CancellationController,
  createCancellationController,
} from "../../utils/cancellation";

const PANE_ID = "aihub-workspace-v145";
const PANEL_TAG = "aihub-workspace-panel";
const PANE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#1769d2" d="M10 1.6l1.5 4.3 4.4 1.5-4.4 1.5-1.5 4.3-1.5-4.3-4.4-1.5 4.4-1.5L10 1.6zm5.2 9.3.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>');

interface OutputBlock {
  id: string;
  title: string;
  text: string;
  elements: Set<any>;
  itemID: any;
  status: "complete" | "running" | "stopped" | "error";
  providerId?: string;
  model?: string;
  question?: string;
  context?: string;
  actionKind?: string;
  noteItemID?: number;
  error?: string;
}

interface PaneHost {
  body: any;
  context: any;
  question: any;
  status: any;
  output: any;
  setSectionSummary?: (summary: string) => void;
  itemID: any;
  item: any;
  running: boolean;
  requestToken: number;
  controller?: CancellationController;
  lastRequest?: OutputRequest;
}

export interface OutputRequest {
  title: string;
  itemID?: any;
  providerId?: string;
  model?: string;
  question?: string;
  context?: string;
  actionKind?: string;
}

const histories = new Map<string, OutputBlock[]>();
let latestReaderContext = "";
let latestReaderItemID: any = null;
let registered = false;
const outputHosts = new Set<any>();
const paneHosts = new Set<PaneHost>();

function esc(value: string): string {
  return (value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseHTMLFragment(doc: any, markup: string): any {
  // Zotero's main window is a XUL document. Assigning `innerHTML` there makes
  // Gecko parse ordinary HTML tags as unsafe XUL and flatten every control.
  // Parse in an HTML document first, then import the XHTML-namespaced nodes.
  const Parser = doc?.defaultView?.DOMParser || (globalThis as any).DOMParser;
  const parsed = new Parser().parseFromString(markup, "text/html");
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes) as any[]) {
    fragment.appendChild(doc.importNode(child, true));
  }
  return fragment;
}

function replaceHTML(host: any, markup: string): void {
  host.replaceChildren(parseHTMLFragment(host.ownerDocument, markup));
}

function appendHTML(host: any, markup: string): void {
  host.appendChild(parseHTMLFragment(host.ownerDocument, markup));
}

function prependHTML(host: any, markup: string): void {
  host.insertBefore(parseHTMLFragment(host.ownerDocument, markup), host.firstChild);
}

function emptyMarkup(): string {
  return `<div class="aihub-out-empty" style="text-align:center;color:#667085;font-size:12px;padding:18px 10px;border:1px dashed #cbd5e1;border-radius:8px">
    <div style="font-size:22px;margin-bottom:5px">✦</div>
    选中文本或载入文献摘要后开始分析<br><span style="font-size:11px">AI 结果会在这里流式显示</span>
  </div>`;
}

function blockMarkup(block: OutputBlock): string {
  const meta = [block.providerId, block.model].filter(Boolean).join(" · ");
  const state = block.status === "running" ? "生成中" : block.status === "stopped" ? "已停止" : block.status === "error" ? "出错" : "完成";
  const saved = !!block.noteItemID;
  return `<div data-aihub-output="${block.id}" style="border:1px solid #dfe3e8;border-radius:7px;padding:9px;margin-bottom:9px;background:var(--material-background,#fff)">
    <div style="display:flex;gap:5px;align-items:center;margin-bottom:5px"><strong style="color:#1769d2;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(block.title)}</strong><span data-aihub-output-state style="margin-left:auto;font-size:10px;color:#667085;white-space:nowrap">${state}</span></div>
    ${block.question ? `<div title="${esc(block.question)}" style="margin-bottom:6px;padding:5px 7px;border-left:3px solid #1769d2;background:color-mix(in srgb,#1769d2 6%,transparent);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">问：${esc(block.question)}</div>` : ""}
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;font-size:10px;color:#98a2b3;min-width:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(meta)}</span><span data-aihub-output-count style="margin-left:auto;white-space:nowrap">${block.text.length.toLocaleString()} 字符</span></div>
    <div class="aihub-out-body" data-expanded="false" tabindex="0" style="max-height:280px;overflow:auto;scrollbar-gutter:stable;white-space:pre-wrap;word-break:break-word;line-height:1.6;padding-right:3px;user-select:text">${esc(block.text)}</div>
    <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap"><button data-output-act="expand" style="font-size:10px">展开全文</button><button data-output-act="copy" style="font-size:10px">复制</button><button data-output-act="save" ${saved ? "disabled" : ""} style="font-size:10px">${saved ? "已保存" : "保存笔记"}</button><button data-output-act="retry" style="font-size:10px">重试</button><button data-output-act="delete" style="font-size:10px;margin-left:auto;color:#b42318">删除</button></div>
  </div>`;
}

function noteContentForBlock(block: OutputBlock): string {
  return block.question
    ? `## 问题\n${block.question}\n\n## 回答\n${block.text}`
    : block.text;
}

function reflectSaved(block: OutputBlock): void {
  for (const element of block.elements) {
    const button = element.closest?.("[data-aihub-output]")?.querySelector?.('[data-output-act="save"]');
    if (!button) continue;
    button.textContent = "已保存";
    button.disabled = true;
  }
}

function historyKey(itemID: any): string {
  const id = Number(itemID);
  return Number.isFinite(id) && id > 0 ? String(id) : "global";
}

function canonicalItemID(itemID: any): any {
  try {
    const item = itemID ? Zotero.Items.get(itemID) : null;
    return item?.parentItemID || itemID;
  } catch {
    return itemID;
  }
}

function loadHistory(itemID: any): OutputBlock[] {
  const key = historyKey(itemID);
  const cached = histories.get(key);
  if (cached) return cached;
  const loaded = sessions.list(itemID).map((entry) => ({ ...entry, itemID, elements: new Set<any>() }));
  histories.set(key, loaded);
  return loaded;
}

function historyForHost(host: any): OutputBlock[] {
  const pane = [...paneHosts].find((candidate) => candidate.output === host);
  return loadHistory(pane?.itemID);
}

function pruneDetached(): void {
  for (const host of [...outputHosts]) if (!host?.isConnected) outputHosts.delete(host);
  for (const host of [...paneHosts]) if (!host.body?.isConnected) paneHosts.delete(host);
  for (const block of [...histories.values()].flat()) {
    for (const element of [...block.elements]) if (!element?.isConnected) block.elements.delete(element);
  }
}

function bindHost(host: any): void {
  for (const block of historyForHost(host)) {
    const element = host.querySelector?.(`[data-aihub-output="${block.id}"] .aihub-out-body`);
    if (element) block.elements.add(element);
  }
}

function revealOutputCard(card: any): void {
  if (!card?.isConnected) return;
  try {
    card.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
  } catch (_) {
    try { card.scrollIntoView(true); } catch (_) {}
  }
}

export function mountOutputHost(host: any): void {
  if (!host) return;
  pruneDetached();
  outputHosts.add(host);
  const history = historyForHost(host);
  replaceHTML(host, history.length ? [...history].reverse().map(blockMarkup).join("") : emptyMarkup());
  bindHost(host);
}

export function unmountOutputHost(host: any): void {
  outputHosts.delete(host);
}

export function clearOutputHistory(itemID?: any): void {
  const key = historyKey(itemID);
  histories.set(key, []);
  sessions.clear(itemID);
  pruneDetached();
  for (const host of outputHosts) {
    if (historyKey([...paneHosts].find((pane) => pane.output === host)?.itemID) === key) replaceHTML(host, emptyMarkup());
  }
}

function getItemTitle(item: any): string {
  try {
    return String(item?.getField?.("title") || "当前文献");
  } catch {
    return "当前文献";
  }
}

function setHostStatus(host: PaneHost, text: string, tone: "normal" | "ok" | "error" = "normal"): void {
  host.status.textContent = text;
  host.status.style.color = tone === "error" ? "#b42318" : tone === "ok" ? "#067647" : "#667085";
}

function updateContextMeta(host: PaneHost): void {
  const count = String(host.context.value || "").length;
  const counter = host.body.querySelector('[data-aihub="context-count"]');
  if (counter) counter.textContent = `${count.toLocaleString()} 字符`;
}

function setBusy(host: PaneHost, busy: boolean): void {
  host.running = busy;
  host.body.querySelectorAll("button[data-kind], [data-aihub=\"send\"]").forEach((button: any) => {
    button.disabled = busy;
  });
  const send = host.body.querySelector('[data-aihub="send"]');
  if (send) send.hidden = busy;
  const stop = host.body.querySelector('[data-aihub="stop"]');
  if (stop) stop.hidden = !busy;
}

function beginHostRequest(host: PaneHost): { controller: CancellationController; token: number } {
  const controller = createCancellationController();
  const token = ++host.requestToken;
  host.controller = controller;
  setBusy(host, true);
  return { controller, token };
}

function finishHostRequest(host: PaneHost, token: number): void {
  if (host.requestToken !== token) return;
  host.controller = undefined;
  setBusy(host, false);
}

function stopHostRequest(host: PaneHost): void {
  const controller = host.controller;
  if (!controller) return;
  // Invalidate the pending task before aborting. This prevents its delayed
  // completion/finally block from overwriting a newer request's UI state.
  host.requestToken++;
  host.controller = undefined;
  setBusy(host, false);
  setHostStatus(host, "已停止，可重新发送", "normal");
  // Restore the controls before aborting transports. In Zotero, XHR.abort()
  // and stream listeners can synchronously perform cleanup; aborting first
  // made the button appear stuck on "停止" even though cancellation began.
  // The incremented request token already isolates this old task's callbacks.
  setTimeout(() => controller.abort(), 0);
}

function launchHostTask(host: PaneHost, label: string, task: () => Promise<void>): void {
  void task().catch((error: any) => {
    try {
      Zotero.debug(`[AIHub] ${label} click handler failed: ${error?.stack || error}`);
    } catch (_) {}
    if (host.controller) {
      host.requestToken++;
      const controller = host.controller;
      host.controller = undefined;
      controller.abort();
    }
    setBusy(host, false);
    setHostStatus(host, `${label}未能启动：${error?.message || String(error)}`, "error");
  });
}

function copyText(text: string): void {
  try {
    // @ts-ignore Gecko chrome globals supplied by Zotero.
    const clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
      // @ts-ignore
      .getService(Components.interfaces.nsIClipboardHelper);
    clipboard.copyString(text);
  } catch (error) {
    throw new Error("无法访问系统剪贴板：" + error);
  }
}

function option(doc: any, value: string, label = value): any {
  const el = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
  el.value = value;
  el.textContent = label;
  return el;
}

function persistProvider(providerID: string, model?: string): void {
  const providers = getProviders();
  const provider = providers.find((p) => p.id === providerID);
  if (!provider) return;
  if (model) {
    provider.defaultModel = model;
    provider.models = [...new Set([model, ...(provider.models || [])])];
  }
  saveProviders(providers);
  setPref("defaultProviderId", providerID);
  flushPrefs();
  registry.load();
}

function currentSectionSummary(providerID = "", model = ""): string {
  const providers = getProviders().filter((provider) => provider.enabled);
  const preferredProviderID = providerID || String(getPref("defaultProviderId") || providers[0]?.id || "");
  const provider = providers.find((entry) => entry.id === preferredProviderID) || providers[0];
  if (!provider) return "需要配置 AI 厂商";
  const selectedModel = model || provider.defaultModel || knownModels(provider)[0] || "请选择模型";
  return `${provider.label || provider.kind} · ${selectedModel}`;
}

function updateSectionSummary(host: PaneHost, providerID: string, model = ""): void {
  host.setSectionSummary?.(currentSectionSummary(providerID, model));
}

function fillModelSelect(select: any, providerID: string, preferred = ""): void {
  const provider = getProviders().find((p) => p.id === providerID);
  select.replaceChildren();
  if (!provider) {
    select.appendChild(option(select.ownerDocument, "", "请先配置厂商"));
    return;
  }
  const models = knownModels(provider);
  for (const model of models) select.appendChild(option(select.ownerDocument, model));
  select.value = preferred || provider.defaultModel || models[0] || "";
}

function updateProviderState(body: any, providerID: string): void {
  const provider = getProviders().find((p) => p.id === providerID);
  const dot = body.querySelector('[data-aihub="provider-dot"]');
  const label = body.querySelector('[data-aihub="provider-label"]');
  if (!dot || !label) return;
  if (!provider) {
    dot.style.background = "#f04438";
    label.textContent = "尚未配置可用厂商，请打开设置";
    return;
  }
  const ready = !!provider.apiKey || provider.kind === "ollama";
  dot.style.background = ready ? "#12b76a" : "#f79009";
  label.textContent = `${provider.label || provider.kind} · ${ready ? "已配置" : "缺少 API Key"}`;
}

async function refreshModels(host: PaneHost, providerSelect: any, modelSelect: any, refresh: any): Promise<void> {
  const providerID = providerSelect.value;
  const provider = registry.byId(providerID);
  if (!provider) return;
  refresh.disabled = true;
  host.status.textContent = "正在从厂商获取模型列表…";
  try {
    const online = (await provider.listModels()).map((m) => m.id).filter(Boolean);
    if (!online.length) throw new Error("厂商没有返回可用模型");
    const providers = getProviders();
    const config = providers.find((p) => p.id === providerID);
    if (!config) return;
    config.models = [...new Set([config.defaultModel, ...online].filter(Boolean))];
    config.modelsRefreshedAt = Date.now();
    if (!config.defaultModel) config.defaultModel = online[0];
    saveProviders(providers);
    flushPrefs();
    registry.load();
    fillModelSelect(modelSelect, providerID, config.defaultModel);
    updateSectionSummary(host, providerID, modelSelect.value);
    host.status.textContent = `已获取 ${online.length} 个在线模型`;
  } catch (error: any) {
    host.status.textContent = "刷新失败：" + (error?.message || String(error));
  } finally {
    refresh.disabled = false;
  }
}

function renderBody({ body, doc, item, setSectionSummary }: any): void {
  const nextItemID = item?.parentItemID || item?.id;
  const existingHost = [...paneHosts].find((entry) => entry.body === body);
  if (
    existingHost &&
    existingHost.body?.isConnected &&
    historyKey(existingHost.itemID) === historyKey(nextItemID)
  ) {
    // Saving a child note triggers Zotero's item notifier and onRender again.
    // Rebuilding the entire mount here used to reset scrolling and detach the
    // live output nodes, making the next answer look as if it never refreshed.
    existingHost.item = item;
    existingHost.itemID = nextItemID;
    existingHost.setSectionSummary = setSectionSummary;
    const title = body.querySelector?.('[data-aihub="item-title"]');
    if (title) {
      title.textContent = getItemTitle(item);
      title.title = getItemTitle(item);
    }
    existingHost.setSectionSummary?.(currentSectionSummary());
    return;
  }
  body.style.cssText = "padding:0;overflow:hidden;font:13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box;min-width:0;";
  replaceHTML(body, `<div style="display:flex;flex-direction:column;gap:10px;min-height:520px;padding:10px;box-sizing:border-box;background:var(--material-background,#f8fafc)">
    <div style="padding:10px;border-radius:9px;background:linear-gradient(135deg,#1769d2,#4f46e5);color:white;box-shadow:0 3px 10px rgba(23,105,210,.18)">
      <div style="display:flex;align-items:center;gap:7px"><strong style="font-size:14px">✦ Zotero AI Hub</strong><span style="margin-left:auto;font-size:10px;opacity:.85">研究工作台</span></div>
      <div data-aihub="item-title" title="${esc(getItemTitle(item))}" style="font-size:11px;opacity:.9;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(getItemTitle(item))}</div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:6px">
      <label style="min-width:0;font-size:11px;color:#667085">厂商<select data-aihub="provider" title="AI 厂商" style="display:block;min-width:0;width:100%;margin-top:3px"></select></label>
      <label style="min-width:0;font-size:11px;color:#667085">模型<select data-aihub="model" title="同一厂商的模型" style="display:block;min-width:0;width:100%;margin-top:3px"></select></label>
    </div>
    <div data-aihub="provider-state" style="display:flex;align-items:center;gap:6px;font-size:11px;color:#667085">
      <span data-aihub="provider-dot" style="width:7px;height:7px;border-radius:50%;background:#98a2b3"></span><span data-aihub="provider-label">检查配置中</span>
      <button data-aihub="refresh" title="从厂商 API 刷新模型列表" style="margin-left:auto;padding:2px 7px;font-size:11px">刷新模型</button>
      <button data-aihub="settings" style="padding:2px 7px;font-size:11px">设置</button>
    </div>
    <div style="border:1px solid #cbdcf7;border-radius:9px;background:color-mix(in srgb, #1769d2 5%, var(--material-background,#fff));padding:8px">
      <div style="display:flex;align-items:center;margin-bottom:6px"><strong style="font-size:12px">快速分析</strong><span style="margin-left:auto;font-size:10px;color:#667085">选文或载入文献后使用</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
        <button data-kind="summary" style="min-height:30px">摘要</button><button data-kind="explain" style="min-height:30px">解释</button><button data-kind="critique" style="min-height:30px">批判分析</button>
        <button data-kind="annotate" style="min-height:30px">智能批注</button><button data-kind="translate" style="min-height:30px">译为中文</button><button data-kind="keywords" style="min-height:30px">关键词</button>
      </div>
    </div>
    <div style="border:1px solid #d9e1ec;border-radius:9px;background:var(--material-background,#fff);padding:8px">
      <div style="display:flex;align-items:center;margin-bottom:6px"><strong style="font-size:12px">分析上下文</strong><span data-aihub="context-count" style="margin-left:auto;font-size:10px;color:#98a2b3">0 字符</span></div>
      <textarea data-aihub="context" rows="4" placeholder="在论文中选中文本，右键选择 AI 助手；也可以粘贴内容或载入当前文献。" style="width:100%;resize:vertical;box-sizing:border-box;padding:7px;border:1px solid #d0d5dd;border-radius:6px;line-height:1.45"></textarea>
      <div style="display:flex;gap:5px;margin-top:6px"><button data-aihub="load-item" style="font-size:11px">载入文献</button><button data-aihub="clear-context" style="font-size:11px">清空</button><button data-aihub="paste-selection" style="font-size:11px;margin-left:auto">使用最近选文</button></div>
    </div>
    <div style="border:1px solid #d9e1ec;border-radius:9px;background:var(--material-background,#fff);padding:8px">
      <div style="font-size:11px;color:#667085;margin-bottom:5px">向当前文献提问</div>
      <textarea data-aihub="question" rows="3" placeholder="输入问题，Ctrl+Enter 发送" style="width:100%;resize:vertical;box-sizing:border-box;padding:7px;border:1px solid #d0d5dd;border-radius:6px"></textarea>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px"><button data-prompt="核心贡献是什么？" style="font-size:10px">核心贡献</button><button data-prompt="研究方法和实验设计有哪些优缺点？" style="font-size:10px">方法评价</button><button data-prompt="这篇文献有哪些局限和可继续研究的问题？" style="font-size:10px">局限与展望</button></div>
      <div style="display:flex;align-items:center;gap:7px;margin-top:7px"><button data-aihub="send" style="background:#1769d2;color:#fff;border-color:#1769d2;font-weight:600;min-width:64px">发送</button><button data-aihub="stop" hidden style="background:#b42318;color:#fff;border-color:#b42318;font-weight:600;min-width:64px">停止</button><span data-aihub="status" role="status" style="font-size:11px;color:#667085;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">就绪</span></div>
    </div>
    <div style="display:flex;align-items:center"><strong style="font-size:12px">当前文献会话</strong><button data-aihub="clear" style="margin-left:auto;font-size:11px;color:#b42318">清空会话</button></div>
    <div data-aihub="output"></div>
  </div>`);

  const providerSelect = body.querySelector('[data-aihub="provider"]');
  const modelSelect = body.querySelector('[data-aihub="model"]');
  const context = body.querySelector('[data-aihub="context"]');
  const question = body.querySelector('[data-aihub="question"]');
  const output = body.querySelector('[data-aihub="output"]');
  const status = body.querySelector('[data-aihub="status"]');
  const previousHost = [...paneHosts].find((entry) => entry.body === body);
  if (previousHost) {
    unmountOutputHost(previousHost.output);
    paneHosts.delete(previousHost);
  }
  const host: PaneHost = {
    body,
    context,
    question,
    output,
    status,
    setSectionSummary,
    itemID: item?.parentItemID || item?.id,
    item,
    running: false,
    requestToken: 0,
  };
  paneHosts.add(host);
  mountOutputHost(output);

  const providers = getProviders().filter((p) => p.enabled);
  for (const provider of providers) providerSelect.appendChild(option(doc, provider.id, provider.label || provider.kind));
  const preferredProvider = String(getPref("defaultProviderId") || providers[0]?.id || "");
  providerSelect.value = providers.some((p) => p.id === preferredProvider) ? preferredProvider : providers[0]?.id || "";
  fillModelSelect(modelSelect, providerSelect.value);
  if (!providers.length) {
    modelSelect.disabled = true;
    body.querySelectorAll("button[data-kind], [data-aihub=\"send\"]").forEach((button: any) => button.disabled = true);
  } else {
    modelSelect.disabled = false;
  }
  updateProviderState(body, providerSelect.value);
  updateSectionSummary(host, providerSelect.value, modelSelect.value);
  const currentIDs = new Set([Number(item?.id), Number(item?.parentItemID)].filter(Boolean));
  if (latestReaderContext && (!latestReaderItemID || currentIDs.has(Number(latestReaderItemID)))) {
    context.value = latestReaderContext;
  }
  updateContextMeta(host);

  providerSelect.addEventListener("change", () => {
    persistProvider(providerSelect.value);
    fillModelSelect(modelSelect, providerSelect.value);
    updateProviderState(body, providerSelect.value);
    updateSectionSummary(host, providerSelect.value, modelSelect.value);
    status.textContent = "已切换厂商";
  });
  modelSelect.addEventListener("change", () => {
    persistProvider(providerSelect.value, modelSelect.value);
    updateSectionSummary(host, providerSelect.value, modelSelect.value);
    status.textContent = "已切换模型：" + modelSelect.value;
  });
  body.querySelector('[data-aihub="refresh"]')?.addEventListener("click", (event: any) =>
    void refreshModels(host, providerSelect, modelSelect, event.currentTarget)
  );
  body.querySelector('[data-aihub="settings"]')?.addEventListener("click", openDashboard);
  body.querySelector('[data-aihub="clear"]')?.addEventListener("click", () => {
    if (host.running) return setHostStatus(host, "请先停止当前生成", "error");
    clearOutputHistory(host.itemID);
    mountOutputHost(host.output);
    setHostStatus(host, "已清空当前文献会话", "ok");
  });
  context.addEventListener("input", () => updateContextMeta(host));
  body.querySelector('[data-aihub="clear-context"]')?.addEventListener("click", () => {
    context.value = "";
    updateContextMeta(host);
    context.focus();
  });
  body.querySelector('[data-aihub="paste-selection"]')?.addEventListener("click", () => {
    if (!latestReaderContext) return setHostStatus(host, "暂无最近选中文本", "error");
    if (latestReaderItemID && !currentIDs.has(Number(latestReaderItemID))) {
      return setHostStatus(host, "最近选文来自另一篇文献，请回到原文献后使用", "error");
    }
    context.value = latestReaderContext;
    updateContextMeta(host);
    setHostStatus(host, "已载入最近选中文本", "ok");
  });
  body.querySelector('[data-aihub="load-item"]')?.addEventListener("click", async () => {
    try {
      const target = host.item || (host.itemID ? await Zotero.Items.getAsync(host.itemID) : null);
      if (!target) throw new Error("没有当前文献");
      const regular = target.isAttachment?.() && target.parentItemID
        ? await Zotero.Items.getAsync(target.parentItemID)
        : target;
      const text = joinItemText(await getItemTextAsync(regular));
      if (!text) throw new Error("当前文献没有可读取的摘要、笔记或全文索引");
      context.value = text;
      updateContextMeta(host);
      setHostStatus(host, "已载入当前文献内容", "ok");
    } catch (error: any) {
      setHostStatus(host, error?.message || String(error), "error");
    }
  });

  const run = async (kind: string) => {
    const text = String(context.value || "").trim();
    if (!text) {
      status.textContent = "请先选中或输入文本";
      context.focus();
      return;
    }
    if (host.running) return;
    const questions: Record<string, string> = {
      explain: "请用清晰易懂但保持学术准确的方式解释这段内容，并说明关键概念之间的关系。",
      critique: "请批判性分析这段内容：论点、证据、隐含假设、方法局限以及可能的反例。",
      keywords: "请提取这段内容最重要的关键词，并分别用一句话解释其在本文语境中的含义。",
    };
    const taskKind = kind === "annotate" ? "annotation" : kind === "translate" ? "translate" : kind === "summary" ? "summary" : "chat";
    saveTaskModel(taskKind as any, { providerId: providerSelect.value, model: modelSelect.value });
    flushPrefs();
    const { controller, token } = beginHostRequest(host);
    host.lastRequest = {
      title: kind === "summary" ? "AI 摘要（选中）" : kind === "annotate" ? "AI 批注（选中）" : kind === "translate" ? "AI 翻译（选中）" : "AI 问答",
      itemID: host.itemID,
      providerId: providerSelect.value,
      model: modelSelect.value,
      question: questions[kind],
      context: text,
      actionKind: kind,
    };
    setHostStatus(host, "正在生成…");
    try {
      const ok = questions[kind]
        ? await actions.doSelectionQuestion(questions[kind], text, host.itemID, { signal: controller.signal, providerId: providerSelect.value, model: modelSelect.value })
        : await actions.doSelectionAction(kind, text, host.itemID, { signal: controller.signal, providerId: providerSelect.value, model: modelSelect.value });
      if (controller.signal.aborted || host.requestToken !== token) return;
      setHostStatus(host, ok ? "已完成" : "生成失败，请查看输出错误", ok ? "ok" : "error");
    } catch (error: any) {
      if (controller.signal.aborted || host.requestToken !== token) return;
      setHostStatus(host, "失败：" + (error?.message || String(error)), "error");
    } finally {
      finishHostRequest(host, token);
    }
  };
  body.querySelectorAll("[data-kind]").forEach((button: any) =>
    button.addEventListener("click", () =>
      launchHostTask(host, "快速分析", () => run(button.dataset.kind))
    )
  );

  const send = body.querySelector('[data-aihub="send"]');
  body.querySelector('[data-aihub="stop"]')?.addEventListener("click", () => {
    stopHostRequest(host);
  });
  body.querySelectorAll("[data-prompt]").forEach((button: any) => button.addEventListener("click", () => {
    question.value = button.dataset.prompt || "";
    question.focus();
  }));
  const ask = async () => {
    const prompt = String(question.value || "").trim();
    if (!prompt) {
      status.textContent = "请输入问题";
      question.focus();
      return;
    }
    if (host.running) return;
    saveTaskModel("chat", { providerId: providerSelect.value, model: modelSelect.value });
    flushPrefs();
    const recentConversation = loadHistory(host.itemID)
      .filter((entry) => entry.status === "complete" && entry.text)
      .slice(-6)
      .map((entry) => `${entry.question ? `用户：${entry.question}\n` : ""}AI（${entry.title}）：${entry.text.slice(0, 3000)}`)
      .join("\n\n")
      .slice(-12000);
    const rawContext = String(context.value || "").trim();
    const baseContext = rawContext.length > 32000
      ? rawContext.slice(0, 32000) + "\n[为加快问答，当前上下文已截取前 32,000 字符]"
      : rawContext;
    let ragContext = "";
    const { controller, token } = beginHostRequest(host);
    try {
      if (getPref("rag.enabled") === true) {
      try {
        const scope = getPref("rag.scope") || "library";
        let itemIDs: any[] = scope === "current" ? [host.itemID] : [];
        if (scope === "selected") {
          try {
            itemIDs = Zotero.getActiveZoteroPane().getSelectedItems()
              .map((selected: any) => selected?.parentItemID || selected?.id)
              .filter(Boolean);
          } catch (_) {}
        }
        setHostStatus(host, "正在检索文献索引…");
        const hits = await rag.search(prompt, parseInt(getPref("rag.topK")) || 5, itemIDs, controller.signal);
        if (controller.signal.aborted || host.requestToken !== token) return;
        if (hits.length) ragContext = `\n\n【RAG 检索来源；回答时请引用 RAG 编号】\n${rag.formatHits(hits)}`;
      } catch (error: any) {
        if (controller.signal.aborted || host.requestToken !== token) return;
        setHostStatus(host, "RAG 检索失败，将仅使用当前上下文：" + (error?.message || error), "error");
      }
      }
      const conversationContext = recentConversation
        ? `${baseContext}\n\n【当前文献最近对话】\n${recentConversation}`
        : baseContext;
      const finalContext = conversationContext + ragContext;
      host.lastRequest = { title: "AI 问答", itemID: host.itemID, providerId: providerSelect.value, model: modelSelect.value, question: prompt, context: baseContext, actionKind: "question" };
      setHostStatus(host, rawContext.length > 32000 ? "上下文较长，已精简后发送…" : "正在连接模型…");
      const ok = await actions.doSelectionQuestion(prompt, finalContext, host.itemID, { signal: controller.signal, providerId: providerSelect.value, model: modelSelect.value });
      if (controller.signal.aborted || host.requestToken !== token) return;
      setHostStatus(host, ok ? "已完成" : "生成失败，请查看输出错误", ok ? "ok" : "error");
    } catch (error: any) {
      if (controller.signal.aborted || host.requestToken !== token) return;
      setHostStatus(host, "失败：" + (error?.message || String(error)), "error");
    } finally {
      finishHostRequest(host, token);
    }
  };
  send?.addEventListener("click", () => launchHostTask(host, "提问", ask));
  question.addEventListener("keydown", (event: any) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      launchHostTask(host, "提问", ask);
    }
  });

  output.addEventListener("click", async (event: any) => {
    const button = event.target?.closest?.("button[data-output-act]");
    const card = button?.closest?.("[data-aihub-output]");
    if (!button || !card) return;
    const block = loadHistory(host.itemID).find((entry) => entry.id === card.dataset.aihubOutput);
    if (!block) return;
    const act = button.dataset.outputAct;
    if (act === "copy") {
      try { copyText(block.text); setHostStatus(host, "已复制该结果", "ok"); } catch { setHostStatus(host, "复制失败", "error"); }
    } else if (act === "expand") {
      const answer = card.querySelector?.(".aihub-out-body");
      const expanded = answer?.dataset.expanded === "true";
      if (answer) {
        answer.dataset.expanded = expanded ? "false" : "true";
        answer.style.maxHeight = expanded ? "280px" : "none";
        answer.style.overflow = expanded ? "auto" : "visible";
      }
      button.textContent = expanded ? "展开全文" : "收起";
    } else if (act === "save") {
      try {
        const target = host.item || (host.itemID ? await Zotero.Items.getAsync(host.itemID) : null);
        const note = await createNoteForItem(target, block.title, noteContentForBlock(block));
        block.noteItemID = Number(note?.id) || undefined;
        sessions.update(block.itemID, block.id, { noteItemID: block.noteItemID });
        reflectSaved(block);
        setHostStatus(host, "已保存为当前文献的 Zotero 子笔记", "ok");
      } catch (error: any) { setHostStatus(host, "保存失败：" + (error?.message || error), "error"); }
    } else if (act === "delete") {
      sessions.remove(host.itemID, block.id);
      histories.set(historyKey(host.itemID), loadHistory(host.itemID).filter((entry) => entry.id !== block.id));
      card.remove();
      if (!loadHistory(host.itemID).length) mountOutputHost(output);
      setHostStatus(host, "已删除该结果", "ok");
    } else if (act === "retry") {
      if (host.running) return;
      context.value = block.context || context.value;
      question.value = block.question || "";
      updateContextMeta(host);
      if (block.actionKind === "question" || block.question) launchHostTask(host, "重试", ask);
      else launchHostTask(host, "重试", () => run(block.actionKind || "summary"));
    }
  });
}

function destroyPanelHost(root: any): void {
  for (const host of [...paneHosts]) {
    if (host.body === root || root?.contains?.(host.body) || host.body?.closest?.(PANEL_TAG) === root) {
      unmountOutputHost(host.output);
      paneHosts.delete(host);
    }
  }
}

function updatePaneHeight(body: any): void {
  try {
    const details = body?.closest?.("item-details");
    const head = body?.closest?.("item-pane-custom-section")?.querySelector?.(".head");
    const view = details?.querySelector?.(".zotero-view-item");
    if (!view || !head) return;
    const height = Math.max(320, Number(view.clientHeight || 0) - Number(head.clientHeight || 0) - 8);
    body.style.setProperty("--details-height", `${height}px`);
  } catch (_) {
    // The library item pane can use a different container than reader tabs.
  }
}

function installPanelBridge(): void {
  Zotero.AIHub = Zotero.AIHub || ({} as any);
  Zotero.AIHub.itemPaneBridge = {
    render: ({ mount, item, sectionBody, setSectionSummary }: any) => {
      if (!mount) return;
      renderBody({ body: mount, doc: mount.ownerDocument, item, setSectionSummary });
      updatePaneHeight(sectionBody);
    },
    destroy: ({ mount, panel }: any) => destroyPanelHost(mount || panel),
  };
}

/** Load the same per-window custom-element layer used by Translate for Zotero. */
export function registerItemPaneWindow(win: any): void {
  if (!win || win.closed || win.customElements?.get?.(PANEL_TAG)) return;
  const rootURI = String(Zotero.AIHub?.rootURI || "");
  if (!rootURI) throw new Error("AI Hub rootURI is unavailable");
  Services.scriptloader.loadSubScript(
    `${rootURI}addon/content/scripts/customElements.js`,
    win,
  );
  if (!win.customElements?.get?.(PANEL_TAG)) {
    throw new Error(`${PANEL_TAG} was not registered in the Zotero window`);
  }
}

export function registerItemPane(): void {
  if (registered) return;
  try {
    installPanelBridge();
    const manager: any = (Zotero as any).ItemPaneManager;
    if (!manager?.registerSection) {
      Zotero.debug("[AIHub] ItemPaneManager.registerSection is unavailable");
      return;
    }
    const paneID = manager.registerSection({
      paneID: PANE_ID,
      pluginID: "zotero-ai-hub@zoteroaihub",
      header: { l10nID: "aihub-pane-header", icon: PANE_ICON },
      sidenav: { l10nID: "aihub-pane-sidenav", icon: PANE_ICON, orderable: false },
      bodyXHTML: `<${PANEL_TAG} />`,
      onItemChange: ({ body, item, setEnabled, setSectionSummary }: any) => {
        if (body) body.dataset.itemID = String(item?.id || "");
        setEnabled?.(!!item);
        setSectionSummary?.(currentSectionSummary());
        // ItemPaneManager only schedules a content refresh when this callback
        // returns true. Translate for Zotero follows the same contract.
        return true;
      },
      onInit: ({ body, setSectionSummary }: any) => {
        body.dataset.aihubInitialized = "true";
        setSectionSummary?.(currentSectionSummary());
      },
      onRender: ({ body, item, setSectionSummary }: any) => {
        const panel = body.querySelector?.(PANEL_TAG);
        if (!panel) {
          Zotero.debug(`[AIHub] ${PANEL_TAG} mount is missing during onRender`);
          return;
        }
        // Set these even when the element has not upgraded yet. A later
        // customElements.define() preserves the values and connectedCallback
        // renders the panel, so startup timing cannot leave a title-only row.
        panel.item = item;
        panel.sectionBody = body;
        panel.setSectionSummary = setSectionSummary;
        if (!panel.render) {
          Zotero.debug(`[AIHub] ${PANEL_TAG} is unavailable during onRender`);
          return;
        }
        panel.render();
        updatePaneHeight(body);
      },
      onDestroy: ({ body }: any) => {
        const panel = body.querySelector?.(PANEL_TAG);
        if (panel?.destroy) panel.destroy();
        else destroyPanelHost(body);
      },
      sectionButtons: [
        {
          type: "openSettings",
          icon: PANE_ICON,
          l10nID: "aihub-pane-settings",
          onClick: () => openDashboard(),
        },
      ],
    });
    registered = !!paneID;
    Zotero.debug(`[AIHub] native item pane registration: requested=${PANE_ID}, returned=${String(paneID)}, registered=${registered}`);
  } catch (error: any) {
    Zotero.debug("[AIHub] registerItemPane failed: " + (error?.stack || error));
  }
}

export function unregisterItemPane(): void {
  try {
    if (registered) (Zotero as any).ItemPaneManager?.unregisterSection?.(PANE_ID);
  } catch (_) {
    // Zotero may already be closing.
  }
  registered = false;
  try {
    if (Zotero.AIHub?.itemPaneBridge) delete Zotero.AIHub.itemPaneBridge;
  } catch (_) {}
  paneHosts.clear();
  outputHosts.clear();
}

export function setReaderContext(text: string, itemID?: any): void {
  latestReaderContext = String(text || "").trim();
  latestReaderItemID = canonicalItemID(itemID) || null;
  pruneDetached();
  for (const host of paneHosts) {
    const hostIDs = new Set([Number(host.itemID), Number(host.item?.id), Number(host.item?.parentItemID)].filter(Boolean));
    if (latestReaderContext && (!latestReaderItemID || hostIDs.has(Number(latestReaderItemID)))) host.context.value = latestReaderContext;
    updateContextMeta(host);
  }
}

/** Open Zotero's native right content pane and scroll to the AI Hub section. */
export async function openAIHubPane(text = "", itemID?: any): Promise<void> {
  if (text) setReaderContext(text, itemID);
  const win: any = Zotero.getMainWindow();
  try {
    const contextPane = win.ZoteroContextPane;
    const inLibrary = win.Zotero_Tabs?.selectedType === "library";
    if (inLibrary) {
      const libraryPane = win.document.getElementById("zotero-item-pane");
      if (libraryPane) libraryPane.collapsed = false;
    } else if (contextPane) {
      contextPane.collapsed = false;
    }
    const sidenav = inLibrary
      ? win.document.querySelector("#zotero-view-item-sidenav")
      : contextPane?.sidenav || win.document.getElementById("zotero-context-pane-sidenav");
    const findAndOpen = async (): Promise<boolean> => {
      const container = sidenav?.container;
      const pane = container?.getPane?.(PANE_ID);
      if (!pane) return false;
      const section = pane.querySelector?.("collapsible-section");
      if (section) {
        section.removeAttribute?.("no-collapse");
        section.collapsible = true;
        section.open = true;
        section.render?.();
      } else {
        pane.collapsible = true;
        pane.open = true;
      }
      if (container.scrollToPane) await container.scrollToPane(PANE_ID, "instant");
      return true;
    };
    if (!(await findAndOpen())) {
      // Zotero creates custom sections asynchronously after a tab switch.
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (await findAndOpen()) break;
      }
    }
    sidenav?.render?.();
  } catch (error: any) {
    Zotero.debug("[AIHub] openAIHubPane failed: " + (error?.stack || error));
  }
}

export function toggleAIHubPane(): void {
  const win: any = Zotero.getMainWindow();
  try {
    const contextPane = win.ZoteroContextPane;
    if (win.Zotero_Tabs?.selectedType === "library") {
      const libraryPane = win.document.getElementById("zotero-item-pane");
      if (!libraryPane || libraryPane.collapsed) void openAIHubPane();
      else libraryPane.collapsed = true;
    } else if (contextPane?.collapsed) void openAIHubPane();
    else if (contextPane) contextPane.collapsed = true;
  } catch (_) {
    void openAIHubPane();
  }
}

export function newOutputBlock(input: string | OutputRequest): {
  append: (text: string) => void;
  done: (status?: "complete" | "stopped" | "error", error?: string) => void;
  saved: (noteItemID: any) => void;
  entry: OutputBlock;
} {
  const request: OutputRequest = typeof input === "string" ? { title: input } : input;
  const history = loadHistory(request.itemID);
  const stored: SessionEntry = sessions.add(request.itemID, {
    title: request.title,
    text: "",
    providerId: request.providerId,
    model: request.model,
    question: request.question,
    context: request.context,
    actionKind: request.actionKind,
    status: "running",
  });
  const block: OutputBlock = {
    ...stored,
    itemID: request.itemID,
    elements: new Set(),
  };
  history.push(block);
  pruneDetached();
  for (const host of outputHosts) {
    const pane = [...paneHosts].find((candidate) => candidate.output === host);
    if (historyKey(pane?.itemID) !== historyKey(request.itemID)) continue;
    host.querySelector?.(".aihub-out-empty")?.remove();
    if (!host.querySelector?.(`[data-aihub-output="${block.id}"]`)) {
      prependHTML(host, blockMarkup(block));
    }
    const element = host.querySelector?.(`[data-aihub-output="${block.id}"] .aihub-out-body`);
    if (element) {
      block.elements.add(element);
      revealOutputCard(element.closest?.("[data-aihub-output]"));
    }
  }
  return {
    append(text: string) {
      block.text += text;
      sessions.update(block.itemID, block.id, { text: block.text }, false);
      pruneDetached();
      for (const element of block.elements) {
        element.textContent = block.text;
        element.scrollTop = element.scrollHeight;
        const counter = element.closest?.("[data-aihub-output]")?.querySelector?.("[data-aihub-output-count]");
        if (counter) counter.textContent = `${block.text.length.toLocaleString()} 字符`;
      }
    },
    done(status = "complete", error = "") {
      block.status = status;
      block.error = error || undefined;
      sessions.update(block.itemID, block.id, { text: block.text, status, error: error || undefined });
      pruneDetached();
      for (const element of block.elements) {
        const card = element.closest?.("[data-aihub-output]");
        const state = card?.querySelector?.("[data-aihub-output-state]");
        if (state) state.textContent = status === "stopped" ? "已停止" : status === "error" ? "出错" : "完成";
        revealOutputCard(card);
      }
    },
    saved(noteItemID: any) {
      block.noteItemID = Number(noteItemID) || undefined;
      sessions.update(block.itemID, block.id, { noteItemID: block.noteItemID });
      reflectSaved(block);
    },
    entry: block,
  };
}

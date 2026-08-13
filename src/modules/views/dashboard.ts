// views/dashboard.ts — configuration dashboard logic (bound to dashboard.html).
import {
  getProviders,
  saveProviders,
  getProviderById,
  getPref,
  setPref,
  flushPrefs,
  ProviderConfig,
  ProviderKind,
  DEFAULT_PROMPTS,
} from "../config";
import { createProvider, registry } from "../providers";
import { rag } from "../features";
import { startMcp, stopMcp, mcpStatus } from "../mcp/server";
import { MODEL_PRESETS as PRESETS, knownModels } from "../modelCatalog";
import { migrateProviderCredentials, setNamedSecret } from "../credentialStore";

const KINDS = Object.keys(PRESETS);

let winRef: any = null;

function $(id: string): any {
  return winRef.document.getElementById(id);
}
function esc(s: string): string {
  return (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---------- Custom dropdowns (replace native <select> for chrome reliability) ----------
// Native HTML <select> popups can fail to open / capture in a chrome:// window
// opened via openDialog (the long-standing "下拉框无法切换保存" bug). We build
// our own div-based dropdown — guaranteed to render and to store the chosen
// value in a `data-value` attribute that saveAll() can always read back.
interface DDOption {
  value: string;
  label: string;
}

function buildDropdown(
  holder: any,
  options: DDOption[],
  initial: string,
  onChange?: (v: string) => void
): void {
  if (!holder || !winRef || !winRef.document) return;
  // Stash options so setDropdownValue can resolve labels.
  (holder as any).__ddOptions = options;
  // Preferred path: custom div dropdown (reliable popup in chrome windows).
  try {
    holder.classList.add("aihub-select");
    holder.innerHTML = "";
    const btn = winRef.document.createElement("button");
    btn.type = "button";
    btn.className = "aihub-select-btn";
    const popup = winRef.document.createElement("div");
    popup.className = "aihub-select-popup";
    popup.style.display = "none";
    for (const o of options) {
      const opt = winRef.document.createElement("div");
      opt.className = "aihub-select-option";
      opt.setAttribute("data-value", o.value);
      opt.textContent = o.label;
      opt.addEventListener("click", (ev: any) => {
        ev.stopPropagation();
        setDropdownValue(holder, o.value);
        popup.style.display = "none";
        if (onChange) onChange(o.value);
      });
      popup.appendChild(opt);
    }
    holder.appendChild(btn);
    holder.appendChild(popup);
    btn.addEventListener("click", (ev: any) => {
      ev.stopPropagation();
      popup.style.display = popup.style.display === "none" ? "block" : "none";
    });
    (holder as any).__isNative = false;
    setDropdownValue(holder, initial);
    return;
  } catch (e) {
    Zotero.debug("[AIHub] buildDropdown custom failed, using <select> fallback: " + e);
  }
  // Fallback path: a native <select> ALWAYS renders its options, so the user
  // can at least pick a value even if the custom popup can't be built.
  try {
    holder.classList.add("aihub-select");
    holder.innerHTML = "";
    const sel = winRef.document.createElement("select");
    if (holder.getAttribute("data-f")) sel.setAttribute("data-f", holder.getAttribute("data-f") as string);
    for (const o of options) {
      const opt = winRef.document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    if (initial) sel.value = initial;
    holder.appendChild(sel);
    (holder as any).__isNative = true;
    sel.addEventListener("change", () => {
      if (onChange) onChange(sel.value);
    });
  } catch (e2) {
    Zotero.debug("[AIHub] buildDropdown native fallback also failed: " + e2);
  }
}

function setDropdownValue(holder: any, v: string): void {
  if (!holder) return;
  v = v || "";
  // Native <select> fallback: set the underlying <select>.value
  if ((holder as any).__isNative) {
    const sel = holder.querySelector("select");
    if (sel) sel.value = v;
    return;
  }
  holder.setAttribute("data-value", v);
  const opts: DDOption[] = (holder as any).__ddOptions || [];
  const o = opts.find((x) => x.value === v);
  const btn = holder.querySelector(".aihub-select-btn");
  if (btn) btn.textContent = (o ? o.label : v) + " ▾";
  holder.querySelectorAll(".aihub-select-option").forEach((el: any) => {
    el.classList.toggle("selected", el.getAttribute("data-value") === v);
  });
}

function getDropdownValue(holder: any): string {
  if (!holder) return "";
  if ((holder as any).__isNative) {
    const sel = holder.querySelector("select");
    return sel ? sel.value || "" : "";
  }
  return holder.getAttribute("data-value") || "";
}

export function openDashboard(): void {
  try {
    // Use chrome:// (registerChrome mapping) — verified pattern in Zotero 9
    // (zotero-ai-butler opens its HTML windows via chrome:// URLs).
    // openDialog does NOT reliably load jar:file:// URLs.
    //
    // IMPORTANT: standalone chrome:// windows (opened via openDialog) have
    // their own global scope and NO `Zotero` global. Pass the Zotero main
    // window as the 4th openDialog argument; the dashboard window then reads
    // `window.arguments[0]` and uses its `Zotero` (same pattern as ai-butler).
    const url = "chrome://aiHub/content/dashboard.html";
    Zotero.getMainWindow().openDialog(
      url,
      "aihub-dashboard",
      "chrome,width=900,height=740,resizable=yes",
      Zotero.getMainWindow()
    );
  } catch (e) {
    Zotero.debug("[AIHub] openDashboard failed: " + e);
  }
}

export function onLoad(win: any): void {
  winRef = win;
  // Bind the save button FIRST and unguarded, so saving always works even if
  // a later rendering step throws. (Previously a thrown error after this point
  // could leave the panel open but the save button unbound → "can't save".)
  bindStatic();
  const safe = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      Zotero.debug(`[AIHub] onLoad step ${label} failed: ${e}`);
    }
  };
  // Build the custom dropdowns first so loadFeatureSettings() can set their
  // persisted values immediately after.
  safe("setupFeatureDropdowns", () => setupFeatureDropdowns());
  // On first run, seed one example provider so the per-row Base URL / API Key
  // columns are visible right away (otherwise the table looks empty).
  safe("seedDefaultProviderIfEmpty", () => seedDefaultProviderIfEmpty());
  safe("renderProviders", () => renderProviders());
  safe("loadFeatureSettings", () => loadFeatureSettings());
  safe("loadRag", () => loadRag());
  safe("loadMcp", () => loadMcp());
  safe("loadPrompts", () => loadPrompts());
  // Close any open dropdown popup when clicking elsewhere in the window.
  winRef.document.addEventListener("click", () => {
    winRef.document.querySelectorAll(".aihub-select-popup").forEach((p: any) => {
      p.style.display = "none";
    });
  });
  Zotero.debug("[AIHub] dashboard onLoad complete; save button bound.");
}

// Seed a single OpenAI example row so users immediately see where to fill
// Base URL / API Key. We seed whenever the provider list is empty UNLESS the
// user has intentionally cleared all providers (tracked by userClearedProviders),
// so a broken earlier run (which left seededDefaultProvider=true with 0 rows)
// is automatically recovered on next open.
function seedDefaultProviderIfEmpty(): void {
  try {
    if (getPref("userClearedProviders") === true) return;
    if (getProviders().length > 0) return;
    const preset: any = PRESETS["openai"] || {};
    const list = getProviders();
    list.push({
      id: "p_default_openai",
      kind: "openai",
      label: "OpenAI（示例）",
      baseURL: preset.baseURL || "",
      apiKey: "",
      defaultModel: preset.defaultModel || preset.models?.[0] || "",
      models: preset.models || [],
      enabled: true,
      priority: 0,
    });
    saveProviders(list);
    setPref("defaultProviderId", "p_default_openai");
    setPref("seededDefaultProvider", true);
    flushPrefs();
  } catch (e) {
    Zotero.debug("[AIHub] seedDefaultProviderIfEmpty failed: " + e);
  }
}

function bindStatic(): void {
  // Guard each binding so a single missing element can't abort the rest.
  const bind = (id: string, fn: () => void) => {
    const el = $(id);
    if (el) el.addEventListener("click", fn);
    else Zotero.debug(`[AIHub] bindStatic: #${id} not found in dashboard DOM`);
  };
  bind("add-provider", () => addProvider(getDropdownValue($("preset-kind")) || "openai"));
  bind("save-btn", saveAll);
  bind("test-all", testAllProviders);
  bind("clear-providers", clearProviders);
  bind("rag-index", () => indexLibrary());
  bind("mcp-restart", () => restartMcp());
}

function renderProviders(): void {
  try {
    const tbody = $("providers-tbody");
    const rows = getProviders();
    tbody.replaceChildren();
    if (rows.length === 0) {
      const tr = winRef.document.createElement("tr");
      const td = winRef.document.createElement("td");
      td.colSpan = 8;
      td.className = "empty-state";
      td.textContent = "还没有添加任何 AI 厂商。在上方选择厂商类型，再点“+ 添加厂商”。";
      tr.appendChild(td);
      tbody.appendChild(tr);
      Zotero.debug("[AIHub] renderProviders: empty state shown");
      return;
    }
    rows.forEach((p) => tbody.appendChild(createProviderRow(p)));
    Zotero.debug(`[AIHub] renderProviders: rendered ${rows.length} provider row(s)`);
  } catch (e) {
    Zotero.debug(`[AIHub] renderProviders failed: ${e}`);
  }
}

function createProviderRow(p: ProviderConfig): any {
  const doc = winRef.document;
  const tr = doc.createElement("tr");
  tr.dataset.id = p.id;
  tr.className = "provider-row";
  const cell = () => {
    const td = doc.createElement("td");
    tr.appendChild(td);
    return td;
  };
  const input = (field: string, value: string, type = "text") => {
    const el = doc.createElement("input");
    el.dataset.f = field;
    el.type = type;
    el.value = value || "";
    return el;
  };

  cell().appendChild(input("label", p.label));

  const kindHolder = doc.createElement("div");
  kindHolder.className = "aihub-select";
  kindHolder.dataset.f = "kind";
  cell().appendChild(kindHolder);

  const base = input("baseURL", p.baseURL);
  base.placeholder = "https://api.example.com/v1";
  cell().appendChild(base);

  const secretCell = doc.createElement("div");
  secretCell.className = "secret-cell";
  const key = input("apiKey", p.apiKey || "", "password");
  key.placeholder = "sk-...";
  secretCell.appendChild(key);
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.dataset.act = "toggle-key";
  toggle.className = "secondary small";
  toggle.textContent = "显示";
  secretCell.appendChild(toggle);
  const secret = input("apiSecret", p.apiSecret || "", "password");
  secret.placeholder = "旧版 ERNIE Secret Key（v2 无需填写）";
  secret.hidden = p.kind !== "ernie" || /qianfan\.bj\.baidubce\.com\/v2/i.test(p.baseURL || "");
  secretCell.appendChild(secret);
  cell().appendChild(secretCell);

  const modelCell = doc.createElement("div");
  modelCell.className = "model-cell";
  const modelHolder = doc.createElement("div");
  modelHolder.className = "aihub-select";
  modelHolder.dataset.f = "model";
  modelCell.appendChild(modelHolder);
  const custom = input("modelCustom", "");
  custom.placeholder = "或自定义模型 ID";
  modelCell.appendChild(custom);
  cell().appendChild(modelCell);

  const priority = input("priority", String(p.priority), "number");
  priority.min = "0";
  cell().appendChild(priority);

  const enabled = input("enabled", "", "checkbox");
  enabled.checked = p.enabled;
  const enabledCell = cell();
  enabledCell.style.textAlign = "center";
  enabledCell.appendChild(enabled);

  const actionsCell = cell();
  actionsCell.className = "provider-actions";
  const del = doc.createElement("button");
  del.type = "button";
  del.dataset.act = "del";
  del.textContent = "删除厂商";
  actionsCell.appendChild(del);
  const test = doc.createElement("button");
  test.type = "button";
  test.dataset.act = "test";
  test.textContent = "测试";
  actionsCell.appendChild(test);
  const refresh = doc.createElement("button");
  refresh.type = "button";
  refresh.dataset.act = "refresh-models";
  refresh.textContent = "刷新模型";
  actionsCell.appendChild(refresh);
  const defaultLabel = doc.createElement("label");
  defaultLabel.className = "default-radio";
  const isDefault = input("isDefault", "", "radio");
  isDefault.name = "default";
  isDefault.checked = getPref("defaultProviderId") === p.id;
  defaultLabel.appendChild(isDefault);
  defaultLabel.appendChild(doc.createTextNode("默认"));
  actionsCell.appendChild(defaultLabel);
  const status = doc.createElement("span");
  status.className = "row-status";
  status.dataset.f = "rowStatus";
  actionsCell.appendChild(status);

  wireRow(tr, p);
  return tr;
}

function wireRow(tr: any, p: ProviderConfig): void {
  const kindSel: any = tr.querySelector('[data-f="kind"]');
  buildDropdown(
    kindSel,
    KINDS.map((k) => ({ value: k, label: k })),
    p.kind,
    (kind: string) => {
      const preset = PRESETS[kind];
      if (!preset) return;
      // Rebuild the model picker for the newly chosen vendor, defaulting to
      // its first preset model (only auto-fills if the user hasn't set one).
      buildModelDropdown(tr, kind, preset.defaultModel || preset.models?.[0] || "", preset.models);
      const urlInput = tr.querySelector('[data-f="baseURL"]');
      if (urlInput && !urlInput.value.trim()) urlInput.value = preset.baseURL || "";
      if (urlInput) urlInput.placeholder = preset.baseURL || "https://api.example.com/v1";
      const secretInput = tr.querySelector('[data-f="apiSecret"]');
      if (secretInput) secretInput.hidden = kind !== "ernie";
    }
  );
  buildModelDropdown(tr, p.kind, p.defaultModel, p.models);
  const delBtn: any = tr.querySelector('[data-act="del"]');
  const testBtn: any = tr.querySelector('[data-act="test"]');
  const toggleBtn: any = tr.querySelector('[data-act="toggle-key"]');
  const refreshBtn: any = tr.querySelector('[data-act="refresh-models"]');
  if (delBtn) delBtn.addEventListener("click", () => removeProvider(p.id));
  else Zotero.debug(`[AIHub] wireRow: del button missing for ${p.id}`);
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const inputs: any[] = Array.from(tr.querySelectorAll('[data-f="apiKey"], [data-f="apiSecret"]')) as any;
      const reveal = inputs.some((input: any) => input.type === "password");
      inputs.forEach((input: any) => (input.type = reveal ? "text" : "password"));
      toggleBtn.textContent = reveal ? "隐藏" : "显示";
    });
  }
  if (testBtn) testBtn.addEventListener("click", () => testProvider(p.id));
  else Zotero.debug(`[AIHub] wireRow: test button missing for ${p.id}`);
  if (refreshBtn) refreshBtn.addEventListener("click", () => refreshProviderModels(tr, p.id));
  // The status area is reserved for this row's own connection-test result.
  // Ollama setup help is shown once above the table, not repeated per vendor.
}

function readRow(tr: any): ProviderConfig {
  const g = (f: string): any => tr.querySelector(`[data-f="${f}"]`);
  const kindEl = g("kind");
  const rawKind = kindEl ? getDropdownValue(kindEl) : "";
  const kind = (rawKind || "custom") as ProviderKind;
  // Custom model picker: prefer the free-text "custom" input; fall back to the
  // selected preset model from the dropdown.
  const customModel = g("modelCustom")?.value?.trim() || "";
  const model = customModel || getDropdownValue(g("model")) || "";
  return {
    id: tr.dataset.id,
    label: g("label").value,
    kind,
    baseURL: g("baseURL").value,
    apiKey: g("apiKey").value.trim(),
    apiSecret: g("apiSecret")?.value?.trim() || undefined,
    defaultModel: model,
    priority: parseInt(g("priority").value) || 0,
    enabled: g("enabled").checked,
    models: [...new Set([
      ...(((tr as any).__aihubModels as string[]) || []),
      ...(getProviderById(tr.dataset.id)?.models || []),
      ...(PRESETS[kind]?.models || []),
      model,
    ].filter(Boolean))],
    modelsRefreshedAt: getProviderById(tr.dataset.id)?.modelsRefreshedAt,
  };
}

// Build (or rebuild) a vendor's model picker: a custom dropdown listing that
// vendor's preset models, PLUS a free-text input so users can enter any model
// ID (newer/custom model, Ollama model name, custom endpoint) not in the list.
function buildModelDropdown(tr: any, kind: string, initial: string, savedModels: string[] = []): void {
  const holder = tr.querySelector('[data-f="model"]');
  if (!holder) return;
  const models = [...new Set([...(savedModels || []), ...(PRESETS[kind]?.models || []), initial].filter(Boolean))];
  (tr as any).__aihubModels = models;
  const opts = models.map((m) => ({ value: m, label: m }));
  const initialInPreset = opts.find((o) => o.value === initial)?.value || "";
  buildDropdown(holder, opts, initialInPreset, undefined);
  const custom = tr.querySelector('[data-f="modelCustom"]');
  if (custom) custom.value = initial && !initialInPreset ? initial : "";
}

function confirmAction(message: string): boolean {
  try {
    if (typeof winRef.confirm === "function") return winRef.confirm(message);
  } catch {
    /* ignore */
  }
  return true;
}

function currentProviderDraft(): ProviderConfig[] {
  const tbody = $("providers-tbody");
  if (!tbody) return getProviders();
  const trs: any[] = Array.from(tbody.querySelectorAll("tr[data-id]")) as any;
  if (!trs.length) return getProviders();
  const draft: ProviderConfig[] = [];
  for (const tr of trs) {
    try {
      draft.push(readRow(tr));
    } catch (e) {
      Zotero.debug("[AIHub] currentProviderDraft skipped row: " + e);
    }
  }
  return draft.length ? draft : getProviders();
}

function persistProviderDraft(list: ProviderConfig[]): void {
  saveProviders(list);
  if (list.length) setPref("userClearedProviders", false);
  flushPrefs();
  registry.load();
  renderProviders();
}

function addProvider(kind: string): void {
  // Preserve values typed into visible rows before re-rendering. Previously,
  // clicking Add silently discarded an unsaved API Key or Base URL.
  const list = currentProviderDraft();
  const preset: any = PRESETS[kind] || {};
  list.push({
    id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    kind: kind as ProviderKind,
    label: kind,
    baseURL: preset.baseURL || "",
    apiKey: "",
    defaultModel: preset.defaultModel || preset.models?.[0] || "",
    models: preset.models || [],
    enabled: true,
    priority: list.length,
  });
  persistProviderDraft(list);
  setStatus("已添加 " + kind + "；请填写配置后点击“保存设置”。", false);
}

function removeProvider(id: string): void {
  const list = currentProviderDraft();
  const target = list.find((p) => p.id === id);
  if (!confirmAction("确定删除 AI 厂商“" + (target?.label || id) + "”吗？")) return;
  const remaining = list.filter((p) => p.id !== id);
  if (remaining.length === 0) {
    setPref("userClearedProviders", true);
    setPref("defaultProviderId", "");
  } else if (!remaining.some((p) => p.id === getPref("defaultProviderId"))) {
    setPref("defaultProviderId", remaining[0].id);
  }
  // Update the default before rendering so the replacement radio button is
  // immediately visible after deleting the current default provider.
  persistProviderDraft(remaining);
  setStatus("已删除“" + (target?.label || id) + "”，剩余 " + remaining.length + " 个厂商。", false);
}

function clearProviders(): void {
  const list = currentProviderDraft();
  if (!list.length) {
    setStatus("当前没有可删除的厂商。", false);
    return;
  }
  if (!confirmAction("确定删除全部 " + list.length + " 个 AI 厂商配置吗？此操作不会删除文献。")) return;
  saveProviders([]);
  setPref("defaultProviderId", "");
  setPref("userClearedProviders", true);
  flushPrefs();
  registry.load();
  renderProviders();
  setStatus("已删除全部 AI 厂商配置。", false);
}

function readAllProviders(): { providers: ProviderConfig[]; defaultId: string } {
  const rows: any[] = Array.from($("providers-tbody").querySelectorAll("tr")) as any;
  const providers: ProviderConfig[] = [];
  let defId = "";
  for (const r of rows) {
    try {
      const cfg = readRow(r);
      providers.push(cfg);
      if (r.querySelector('[data-f="isDefault"]')?.checked) defId = cfg.id;
      Zotero.debug(
        `[AIHub] readAll row ${cfg.id}: kind=${cfg.kind} model=${cfg.defaultModel}`
      );
    } catch (e) {
      Zotero.debug(`[AIHub] skipping unreadable provider row: ${e}`);
    }
  }
  return { providers, defaultId: defId || providers[0]?.id || "" };
}

async function testProvider(id: string): Promise<void> {
  const tr = (Array.from($("providers-tbody").querySelectorAll("tr")) as any).find(
    (r: any) => r.dataset.id === id
  );
  if (!tr) return;
  const cfg = readRow(tr);
  const rs: any = tr.querySelector('[data-f="rowStatus"]');
  const setRow = (msg: string, err: boolean) => {
    if (rs) {
      rs.textContent = msg;
      rs.style.color = err ? "#c5221f" : "#188038";
    }
  };
  try {
    const p = createProvider(cfg);
    // For OpenAI-compatible / Ollama, `listModels()` does the real network
    // call and proves connectivity (and reports how many models are visible).
    // For Anthropic / Gemini / ERNIE, listModels is static, so use the real
    // testConnection() request instead.
    const networkModels = ["openai", "deepseek", "qwen", "kimi", "openrouter", "custom", "ollama"];
    if (networkModels.includes(cfg.kind)) {
      const models = await p.listModels();
      if (!models.length) throw new Error("无法获取模型列表，请检查 baseURL 与密钥。");
      setRow(`✓ 连通正常（可列出 ${models.length} 个模型）`, false);
      setStatus(`厂商 ${cfg.label} ✓ 连通正常（可列出 ${models.length} 个模型）`, false);
    } else {
      await p.testConnection();
      setRow("✓ 连通正常", false);
      setStatus(`厂商 ${cfg.label} ✓ 连通正常`, false);
    }
  } catch (e: any) {
    setRow(`✗ ${e?.message || e}`, true);
    setStatus(`厂商 ${cfg.label} 失败：${e?.message || e}`, true);
  }
}

async function refreshProviderModels(tr: any, id: string): Promise<void> {
  const cfg = readRow(tr);
  const status: any = tr.querySelector('[data-f="rowStatus"]');
  if (status) status.textContent = "正在获取模型…";
  try {
    const models = (await createProvider(cfg).listModels()).map((m) => m.id).filter(Boolean);
    if (!models.length) throw new Error("厂商未返回可用模型");
    const merged = [...new Set([cfg.defaultModel, ...models].filter(Boolean))];
    cfg.modelsRefreshedAt = Date.now();
    buildModelDropdown(tr, cfg.kind, cfg.defaultModel, merged);
    if (status) {
      status.textContent = `✓ ${models.length} 个在线模型`;
      status.style.color = "#188038";
    }
    const drafts = currentProviderDraft().map((provider) => provider.id === id
      ? { ...provider, models: merged, modelsRefreshedAt: cfg.modelsRefreshedAt }
      : provider);
    saveProviders(drafts);
    flushPrefs();
    registry.load();
    setStatus(`已刷新 ${cfg.label} 的模型列表，可在“默认模型”中切换。`, false);
  } catch (e: any) {
    if (status) {
      status.textContent = `✗ ${e?.message || e}`;
      status.style.color = "#c5221f";
    }
  }
}

async function testAllProviders(): Promise<void> {
  registry.load();
  const res = await registry.testAll();
  const msg = res.map((r) => `${r.id}: ${r.ok ? "OK" : "✗ " + r.message}`).join("  |  ");
  setStatus(msg, res.some((r) => !r.ok));
}

function loadFeatureSettings(): void {
  $("f-temperature").value = getPref("temperature") || "0.7";
  $("f-maxTokens").value = getPref("maxTokens") || "4096";
  $("f-autoSaveNotes").checked = getPref("autoSaveNotes") === true;
  setDropdownValue($("f-outputLanguage"), getPref("outputLanguage") || "auto");
  setDropdownValue($("f-routingStrategy"), getPref("routingStrategy") || "priority");
  $("f-fallbackEnabled").checked = getPref("fallbackEnabled") !== false;
  $("f-systemPrompt").value = getPref("systemPrompt") || "";
}

// Build the static custom dropdowns (output language, routing strategy, and
// the "add provider" preset picker) with their option lists and saved values.
function setupFeatureDropdowns(): void {
  buildDropdown(
    $("f-outputLanguage"),
    [
      { value: "auto", label: "自动" },
      { value: "zh", label: "中文" },
      { value: "en", label: "English" },
    ],
    getPref("outputLanguage") || "auto"
  );
  buildDropdown(
    $("f-routingStrategy"),
    [
      { value: "priority", label: "优先级" },
      { value: "roundRobin", label: "轮询" },
    ],
    getPref("routingStrategy") || "priority"
  );
  buildDropdown(
    $("preset-kind"),
    KINDS.map((k) => ({ value: k, label: k })),
    "openai"
  );
  buildDropdown(
    $("rag-scope"),
    [
      { value: "current", label: "当前文献" },
      { value: "selected", label: "当前选择" },
      { value: "library", label: "整个索引库" },
    ],
    getPref("rag.scope") || "library"
  );
}

function loadRag(): void {
  $("rag-enabled").checked = getPref("rag.enabled") === true;
  $("rag-embeddingApi").value = getPref("rag.embeddingApi") || "";
  $("rag-embeddingKey").value = getPref("rag.embeddingKey") || "";
  $("rag-embeddingModel").value = getPref("rag.embeddingModel") || "text-embedding-3-small";
  $("rag-topK").value = getPref("rag.topK") || "5";
  setDropdownValue($("rag-scope"), getPref("rag.scope") || "library");
}

function loadMcp(): void {
  $("mcp-enabled").checked = getPref("mcp.enabled") !== false;
  $("mcp-port").value = getPref("mcp.port") || 23121;
  $("mcp-allowRemote").checked = getPref("mcp.allowRemote") === true;
  $("mcp-write").checked = getPref("mcp.write.enabled") === true;
  $("mcp-status").textContent = mcpStatus();
}

function loadPrompts(): void {
  const area = $("prompts-area");
  area.innerHTML = "";
  const PROMT_HINTS: Record<string, string> = {
    summary: "生成结构化摘要。占位符：{{text}}（文献内容）",
    summaryDeep: "多轮深度阅读提炼。占位符：{{text}}",
    annotation: "对选中文本写学术批注。占位符：{{text}}（选中文本）",
    chat: "阅读器问答助手。占位符：{{context}}（文献上下文）、{{question}}",
    translate: "翻译。占位符：{{text}}、{{target}}（目标语言）",
    review: "多篇文献综述。占位符：{{text}}（文献集）",
    mindmap: "生成思维导图节点。占位符：{{text}}",
  };
  for (const name of Object.keys(DEFAULT_PROMPTS)) {
    const block = winRef.document.createElement("div");
    block.className = "prompt-block";
    block.innerHTML = `<label title="${esc(PROMT_HINTS[name] || "")}">${name}<span class="help-tip" title="${esc(PROMT_HINTS[name] || "")}">ⓘ</span></label><textarea data-prompt="${name}" rows="3" title="${esc(PROMT_HINTS[name] || "")}">${esc(
      getPref(`prompts.${name}`) || DEFAULT_PROMPTS[name]
    )}</textarea>`;
    area.appendChild(block);
  }
}

async function saveAll(): Promise<void> {
  try {
    // Guard: if the dashboard window was already torn down, saving is impossible
    // (previously this failed silently and looked like "save did nothing").
    if (!winRef || winRef.closed) {
      Zotero.debug("[AIHub] saveAll: dashboard window already closed");
      return;
    }

    const { providers, defaultId } = readAllProviders();
    await migrateProviderCredentials(providers);

    // ----- Validation (report, but DO NOT block saving to avoid data loss) -----
    const errors: string[] = [];
    const invalidIds = new Set<string>();
    providers.forEach((p) => {
      const isLocal = p.kind === "ollama"; // Ollama needs no key / fixed local URL
      const mark = (msg: string) => {
        errors.push(`「${p.label}」${msg}`);
        invalidIds.add(p.id);
      };
      if (!isLocal && !p.baseURL.trim()) mark("缺少 Base URL");
      else if (!isLocal && !/^https?:\/\//i.test(p.baseURL.trim()))
        mark("Base URL 需以 http(s):// 开头");
      if (!isLocal && !p.apiKey.trim()) mark("缺少 API Key");
      if (p.kind === "ernie" && !p.apiSecret?.trim()) mark("缺少 Secret Key");
      if (!p.defaultModel.trim()) mark("缺少默认模型");
    });
    // Highlight invalid rows' inputs in red so the user sees what to fix.
    try {
      const tbody = $("providers-tbody");
      (Array.from(tbody.querySelectorAll("tr")) as any[]).forEach((tr: any) => {
        const bad = invalidIds.has(tr.dataset?.id);
        (Array.from(tr.querySelectorAll("input")) as any[]).forEach((inp: any) => {
          inp.style.borderColor = bad ? "#c5221f" : "";
        });
      });
    } catch {
      /* ignore */
    }

    // Data-loss guard: if the dashboard table failed to render, readAllProviders
    // returns 0 rows even though storage has providers. Overwriting with an
    // empty list would silently wipe the user's config. In that case, keep the
    // stored providers and only save the other settings.
    const storedCount = getProviders().length;
    if (providers.length === 0 && storedCount > 0) {
      Zotero.debug(
        `[AIHub] saveAll: DOM read 0 rows but ${storedCount} providers exist in storage; skipping providers overwrite to avoid data loss`
      );
      setStatus("未读取到厂商行（界面可能未渲染），已保留原有厂商配置，仅保存其它设置。", true);
    } else {
      saveProviders(providers);
      setPref("defaultProviderId", defaultId);
    }

    setPref("temperature", $("f-temperature").value);
    setPref("maxTokens", $("f-maxTokens").value);
    setPref("autoSaveNotes", $("f-autoSaveNotes").checked);
    setPref("outputLanguage", getDropdownValue($("f-outputLanguage")));
    setPref("routingStrategy", getDropdownValue($("f-routingStrategy")));
    setPref("fallbackEnabled", $("f-fallbackEnabled").checked);
    setPref("systemPrompt", $("f-systemPrompt").value);

    setPref("rag.enabled", $("rag-enabled").checked);
    setPref("rag.embeddingApi", $("rag-embeddingApi").value);
    await setNamedSecret("rag:embeddingKey", $("rag-embeddingKey").value);
    setPref("rag.embeddingKey", $("rag-embeddingKey").value);
    setPref("rag.embeddingModel", $("rag-embeddingModel").value);
    setPref("rag.topK", $("rag-topK").value);
    setPref("rag.scope", getDropdownValue($("rag-scope")) || "library");

    setPref("mcp.enabled", $("mcp-enabled").checked);
    setPref("mcp.port", parseInt($("mcp-port").value) || 23121);
    setPref("mcp.allowRemote", $("mcp-allowRemote").checked);
    setPref("mcp.write.enabled", $("mcp-write").checked);

    for (const name of Object.keys(DEFAULT_PROMPTS)) {
      const ta = winRef.document.querySelector(`textarea[data-prompt="${name}"]`);
      if (ta) setPref(`prompts.${name}`, ta.value);
    }

    // Persist to disk immediately so a Zotero restart can't lose the data.
    flushPrefs();
    registry.load();

    // Re-read from disk to PROVE persistence and give the user feedback.
    const saved = getProviders();
    if (errors.length) {
      const head = errors.slice(0, 3).join("；");
      setStatus(
        `已保存 ${saved.length} 个厂商（已写入本地配置），但有 ${errors.length} 项需修正：${head}${
          errors.length > 3 ? "…" : ""
        }（红框处需补全）`,
        true
      );
    } else {
      setStatus(`已保存 ${saved.length} 个厂商 ✓（已写入本地配置，重启 Zotero 也不会丢失）`, false);
    }
    Zotero.debug(
      `[AIHub] saved ${saved.length} providers; defaultId=${defaultId}; defaultProviderId=${getPref("defaultProviderId")}`
    );
    Zotero.debug(`[AIHub] SAVE OK: ${saved.length} provider configurations persisted (credentials redacted)`);
    // Diagnose dropdown persistence: log what was actually read from the DOM.
    try {
      Zotero.debug(
        `[AIHub] saveAll read: kinds=${providers
          .map((p) => p.kind)
          .join(",")}; lang=${getDropdownValue($("f-outputLanguage"))}; strategy=${getDropdownValue(
          $("f-routingStrategy")
        )}`
      );
    } catch (e) {
      /* ignore */
    }
  } catch (e: any) {
    setStatus(`保存失败：${e?.message || e}`, true);
    Zotero.debug(`[AIHub] saveAll failed: ${e}`);
  }
}

async function indexLibrary(): Promise<void> {
  let items: any[] = [];
  try {
    items = Zotero.getActiveZoteroPane().getSelectedItems();
  } catch {
    /* ignore */
  }
  if (!items.length) {
    $("rag-status").textContent = "请先在文献库中选择要索引的条目。";
    return;
  }
  $("rag-status").textContent = "索引中…";
  try {
    const n = await rag.indexItems(items);
    const info = rag.stats();
    $("rag-status").textContent = `本次更新 ${n} 个片段；索引共 ${info.documents} 篇文献、${info.chunks} 个片段。`;
  } catch (e: any) {
    $("rag-status").textContent = "索引失败：" + (e?.message || e);
  }
}

async function restartMcp(): Promise<void> {
  try {
    stopMcp();
    if (getPref("mcp.enabled") !== false) {
      startMcp();
      $("mcp-status").textContent = mcpStatus();
    } else {
      $("mcp-status").textContent = "MCP 已禁用。";
    }
  } catch (e: any) {
    $("mcp-status").textContent = "重启失败：" + (e?.message || e);
  }
}

function setStatus(msg: string, isErr: boolean): void {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? "#c5221f" : "#188038";
}

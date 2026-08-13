// locale.ts — FTL string lookup with a built-in fallback dictionary.
import { logWarn } from "./logger";

// Fallback strings so the UI works even if FTL wiring differs across Zotero builds.
const FALLBACK: Record<string, string> = {
  "aihub.menu.summary": "AI 摘要",
  "aihub.menu.summaryMulti": "AI 多篇摘要",
  "aihub.menu.annotation": "AI 批注",
  "aihub.menu.chat": "AI 问答",
  "aihub.menu.translate": "AI 翻译",
  "aihub.menu.mindmap": "AI 思维导图",
  "aihub.menu.review": "生成文献综述",
  "aihub.menu.export": "导出笔记",
  "aihub.menu.openDashboard": "AI Hub 设置",
  "aihub.menu.openMCP": "MCP 服务状态",
  "aihub.toast.started": "AI Hub 已开始处理…",
  "aihub.toast.done": "处理完成",
  "aihub.toast.error": "出错了：",
  "aihub.toast.noProvider": "未配置可用的 AI 厂商，请先打开设置。",
  "aihub.toast.noKey": "缺少 API 密钥，请在设置中填写。",
  "aihub.mcp.started": "MCP 服务已启动：",
  "aihub.mcp.stopped": "MCP 服务已停止",
};

export function getString(key: string, args?: Record<string, any>): string {
  // Runtime keys use dots while aiHub.ftl uses hyphenated Fluent ids. Some
  // Zotero releases return the bundle name ("aiHub") for this mismatch,
  // which made every context-menu entry display the same label. Built-in
  // action strings are authoritative and keep the menu usable in all builds.
  let s: string | undefined = FALLBACK[key];
  if (!s) {
    try {
      if (Zotero?.Intl?.getString) {
        const r = Zotero.Intl.getString("aiHub", key, args);
        if (r && r !== key && r.toLowerCase() !== "aihub") s = r;
      }
    } catch (e) {
      logWarn("locale getString failed", key, e);
    }
  }
  if (!s) return key;
  if (args) {
    for (const k of Object.keys(args)) {
      s = s.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), String(args[k]));
    }
  }
  return s;
}

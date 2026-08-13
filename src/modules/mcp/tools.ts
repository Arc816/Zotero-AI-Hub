// mcp/tools.ts — MCP tool catalog (Zotero read tools + AI tools) and dispatch.
import * as features from "../features";
import { getItemText, joinItemText } from "../features/sources";
import { getPref } from "../config";
import { logWarn } from "../../utils/logger";

const WRITE_TOOLS = new Set(["zotero_add_note"]);
const textResult = (text: string) => ({ content: [{ type: "text", text: String(text) }] });

export function toolsList(): any[] {
  return [
    {
      name: "search_library",
      description: "按关键词搜索当前 Zotero 文献库",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "get_item_details",
      description: "获取某条文献的字段信息",
      inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    },
    {
      name: "get_annotations",
      description: "获取某条文献的批注文本",
      inputSchema: { type: "object", properties: { itemId: { type: "number" } }, required: ["itemId"] },
    },
    {
      name: "get_collections",
      description: "列出文献库中的收藏夹",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "ai_summarize",
      description: "对指定文献生成 AI 摘要",
      inputSchema: { type: "object", properties: { itemId: { type: "number" } }, required: ["itemId"] },
    },
    {
      name: "ai_chat",
      description: "基于提供的上下文向 AI 提问",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" }, context: { type: "string" } },
        required: ["question"],
      },
    },
    {
      name: "ai_annotate",
      description: "为选中文本生成 AI 批注",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "ai_translate",
      description: "翻译文本到目标语言",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, target: { type: "string" } },
        required: ["text"],
      },
    },
    {
      name: "ai_mindmap",
      description: "将文本提炼为思维导图大纲",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "zotero_add_note",
      description: "（写操作，受门控）向文献添加子笔记",
      inputSchema: {
        type: "object",
        properties: { parentId: { type: "number" }, content: { type: "string" } },
        required: ["parentId", "content"],
      },
    },
  ];
}

async function callZoteroTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "search_library": {
      const s = new Zotero.Search();
      s.addCondition("title", "contains", args.query || "");
      const ids = await s.search();
      const items = ids.slice(0, 20).map((id: number) => {
        const it = Zotero.Items.get(id);
        return { id, title: it?.getField?.("title") || "", year: it?.getField?.("date") || "" };
      });
      return textResult(JSON.stringify(items, null, 2));
    }
    case "get_item_details": {
      const it = Zotero.Items.get(args.id);
      if (!it) return textResult("未找到该条目。");
      return textResult(
        JSON.stringify(
          { id: it.id, title: it.getField("title"), abstract: it.getField("abstractNote"), type: it.getItemType() },
          null,
          2
        )
      );
    }
    case "get_annotations": {
      const it = Zotero.Items.get(args.itemId);
      if (!it) return textResult("未找到该条目。");
      const t = getItemText(it);
      return textResult(t.annotations.join("\n---\n") || "（无批注）");
    }
    case "get_collections": {
      const lib = Zotero.Libraries.userLibraryID;
      const cols = Zotero.Collections.getByLibrary(lib).map((c: any) => ({ id: c.id, name: c.name }));
      return textResult(JSON.stringify(cols, null, 2));
    }
    default:
      return textResult("");
  }
}

async function callAITool(name: string, args: any): Promise<any> {
  switch (name) {
    case "ai_summarize": {
      const it = Zotero.Items.get(args.itemId);
      if (!it) return textResult("未找到该条目。");
      const text = await features.summarizeItem(it);
      return textResult(text);
    }
    case "ai_chat": {
      const text = await features.chat(args.question, args.context || "", {});
      return textResult(text);
    }
    case "ai_annotate": {
      const text = await features.annotate(args.text || "");
      return textResult(text);
    }
    case "ai_translate": {
      const text = await features.translate(args.text || "", args.target || "English");
      return textResult(text);
    }
    case "ai_mindmap": {
      const text = await features.mindmap(args.text || "");
      return textResult(text);
    }
    default:
      return textResult("");
  }
}

export async function handleToolCall(name: string, args: any): Promise<any> {
  // Write gating
  if (WRITE_TOOLS.has(name)) {
    if (getPref("mcp.write.enabled") !== true) {
      return { isError: true, content: [{ type: "text", text: "写操作未启用（设置 → MCP → 允许写操作）。" }] };
    }
    if (name === "zotero_add_note") {
      const note = new Zotero.Item("note");
      note.parentID = args.parentId;
      note.setNote(args.content || "");
      await note.save();
      return textResult("已添加笔记，id=" + note.id);
    }
  }

  try {
    if (name.startsWith("ai_")) return await callAITool(name, args);
    return await callZoteroTool(name, args);
  } catch (e: any) {
    logWarn("handleToolCall error", name, e);
    return { isError: true, content: [{ type: "text", text: "工具执行失败：" + (e?.message || e) }] };
  }
}

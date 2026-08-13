// addon.ts — assembles the Zotero.AIHub namespace object.
import { hooks } from "./modules/hooks";
import * as dashboard from "./modules/views/dashboard";
import * as contextMenu from "./modules/views/contextMenu";
import * as toolbar from "./modules/views/toolbar";
import * as chat from "./modules/views/chat";
import * as itemPane from "./modules/views/itemPane";
import * as readerMenu from "./modules/views/readerMenu";
import * as readerPanel from "./modules/views/readerPanel";
import { registry } from "./modules/providers";
import { LLMClient } from "./modules/client";
import * as features from "./modules/features";
import { startMcp, stopMcp, mcpStatus } from "./modules/mcp/server";

export function createAddon() {
  return {
    hooks,
    views: { dashboard, contextMenu, toolbar, chat, itemPane, readerMenu, readerPanel },
    registry,
    client: LLMClient,
    features,
    mcp: { startMcp, stopMcp, mcpStatus },
  };
}

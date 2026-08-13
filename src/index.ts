// index.ts — bundle entry. Assigns the Zotero.AIHub namespace on load.
import { createAddon } from "./addon";

const addon = createAddon();
// Expose globally so bootstrap.js / Zotero can drive the lifecycle.
(Zotero as any).AIHub = addon;

export function startup(payload: any, reason: any) {
  return addon.hooks.onStartup(payload);
}
export function shutdown(payload: any, reason: any) {
  return addon.hooks.onShutdown(reason);
}

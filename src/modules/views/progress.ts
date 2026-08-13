// views/progress.ts — user-facing progress toasts and streaming overlays.
import { logWarn } from "../../utils/logger";

export type ToastType = "info" | "error" | "success";

export function notify(message: string, type: ToastType = "info"): void {
  try {
    const pw = new Zotero.ProgressWindow();
    pw.changeHeadline(message);
    if (type === "error") pw.changeHeadline("⚠ " + message);
    pw.show();
    pw.startCloseTimer(type === "error" ? 6000 : 4000);
  } catch (e) {
    logWarn("notify failed", e);
    Zotero.debug("[AIHub] " + message);
  }
}

export interface Overlay {
  setText(t: string): void;
  close(): void;
}

export function createOverlay(headline: string): Overlay {
  let pw: any = null;
  try {
    pw = new Zotero.ProgressWindow();
    pw.changeHeadline(headline);
    pw.show();
  } catch (e) {
    logWarn("createOverlay failed", e);
  }
  let acc = "";
  return {
    setText(t: string) {
      acc += t;
      try {
        pw?.setProgress?.(Math.min(95, (acc.length / 4000) * 100));
      } catch {
        /* ignore */
      }
    },
    close() {
      try {
        pw?.startCloseTimer(3000);
      } catch {
        /* ignore */
      }
    },
  };
}

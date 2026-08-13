// logger.ts — leveled logging through Zotero.debug.

import { getPref } from "../modules/config";

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function currentLevel(): number {
  try {
    const l = getPref("logLevel");
    return LEVELS[l] ?? 1;
  } catch {
    return 1;
  }
}

export function log(level: keyof typeof LEVELS, ...args: any[]): void {
  if (LEVELS[level] < currentLevel()) return;
  const tag = `[AIHub:${level}]`;
  try {
    Zotero.debug(tag + " " + args.map(stringify).join(" "));
  } catch {
    /* ignore */
  }
}

function stringify(a: any): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export const logDebug = (...a: any[]) => log("debug", ...a);
export const logInfo = (...a: any[]) => log("info", ...a);
export const logWarn = (...a: any[]) => log("warn", ...a);
export const logError = (...a: any[]) => log("error", ...a);

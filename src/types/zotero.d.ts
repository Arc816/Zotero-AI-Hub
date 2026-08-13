// Ambient declarations for the Zotero / XPCOM runtime.
// Kept intentionally loose (any) so the plugin builds without the full
// zotero-types package. esbuild does not type-check, so this only serves tsc.

declare const Zotero: any;
declare const Components: any;
declare const Services: any;
declare const Cu: any;
declare const Cc: any;
declare const Ci: any;
declare const ChromeUtils: any;

// Commonly used globals inside the XPCOM sandbox.
declare function setTimeout(handler: any, timeout?: number): any;
declare function clearTimeout(id: any): void;
declare function setInterval(handler: any, timeout?: number): any;
declare function clearInterval(id: any): void;

interface Window extends any {}
declare const window: any;

// Allow JSON import if needed.
declare module "*.json" {
  const value: any;
  export default value;
}

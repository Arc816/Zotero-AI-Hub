// esbuild bundler for zotero-ai-hub
// Produces a single IIFE bundle loaded via loadSubScript into a Zotero sandbox.
import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const outfile = "addon/content/scripts/aiHub.js";

const ctx = await esbuild.context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile,
  format: "iife",
  platform: "browser",
  target: ["firefox115"],
  logLevel: "info",
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // Keep these as external globals resolved at runtime inside the XPCOM sandbox.
  // (We intentionally do NOT bundle Zotero/Components/Services.)
});

await ctx.rebuild();
console.log(`[esbuild] bundled -> ${outfile}`);
await ctx.dispose();

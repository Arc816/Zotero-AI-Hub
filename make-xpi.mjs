// make-xpi.mjs — package the add-on into an installable .xpi (zip).
//
// NOTE: We intentionally use a built-in Node zip writer instead of
// PowerShell `Compress-Archive`. On Windows, Compress-Archive stores entry
// names with BACKSLASHES (e.g. "addon\content\scripts\aiHub.js"), and
// Zotero's xpi reader can only resolve FORWARD-SLASH paths — backslashes
// silently break script/resource loading. This writer forces "/" separators.
import {
  existsSync,
  rmSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const out = "zotero-ai-hub.xpi";

if (!existsSync("addon/content/scripts/aiHub.js")) {
  console.error("[xpi] aiHub.js not found — run `node esbuild.config.mjs` first.");
  process.exit(1);
}
try {
  rmSync(out);
} catch {
  /* ignore */
}

// Stage the required layout: bootstrap.js MUST sit at the xpi root for Zotero 7.
const stage = mkdtempSync(join(tmpdir(), "aihub-"));
cpSync("addon/bootstrap.js", join(stage, "bootstrap.js"));
cpSync("addon/content", join(stage, "addon", "content"), { recursive: true });
cpSync("manifest.json", join(stage, "manifest.json"));
cpSync("prefs.js", join(stage, "prefs.js"));
cpSync("update.json", join(stage, "update.json"));
cpSync("locale", join(stage, "locale"), { recursive: true });

// ---- Native Node zip writer (DEFLATE, forward-slash entry names) ----
function buildZip(stageDir, outPath) {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        // Entry name relative to the stage dir, always using "/" separators.
        const entry = relative(stageDir, full).split(sep).join("/");
        files.push({ entry, data: readFileSync(full) });
      }
    }
  })(stageDir);

  // CRC-32 (IEEE 802.3) table.
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const localParts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const crc = crc32(f.data);
    const comp = deflateRawSync(f.data); // raw DEFLATE (RFC 1951) -> zip method 8
    const nameBuf = Buffer.from(f.entry, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); // compressed size
    local.writeUInt32LE(f.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // central dir header signature
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8); // flags
    cen.writeUInt16LE(8, 10); // method
    cen.writeUInt16LE(0, 12); // mod time
    cen.writeUInt16LE(0, 14); // mod date
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // extra
    cen.writeUInt16LE(0, 32); // comment
    cen.writeUInt16LE(0, 34); // disk number
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(outPath, Buffer.concat([localBuf, centralBuf, end]));
  return files.length;
}

try {
  const count = buildZip(stage, out);
  console.log(`[xpi] wrote ${out} (${count} entries, forward-slash paths)`);
} catch (e) {
  console.error("[xpi] packaging failed:", e.message);
  process.exit(1);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

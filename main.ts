// main.ts — news-image-20261123 entry program.
//
// Copies the pre-rendered front page (entry.png, in this repository) to the
// output directory as entry.png, and verifies the copy byte for byte.
// Standard library only, no network, deterministic: the same input always
// produces the same output bytes.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1048576; // 1 MiB
const MAX_DIM = 1024; // pixels
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "entry.png");
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const dst = join(outDir, "entry.png");

const data = readFileSync(src);

if (!data.subarray(0, 8).equals(PNG_MAGIC)) {
  throw new Error("entry.png is not a PNG file");
}
if (data.length > MAX_BYTES) {
  throw new Error(`entry.png is ${data.length} bytes, over the 1 MiB limit`);
}

// Walk every PNG chunk and check its CRC, so a truncated or corrupted file
// is refused instead of copied: the image must be whole, every chunk with
// its checksum, ending in IEND. CRC-32 (ISO 3309) over type + data.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
{
  let off = 8;
  let first = true;
  let sawIend = false;
  while (off < data.length) {
    if (off + 12 > data.length) {
      throw new Error("entry.png is truncated inside a chunk header");
    }
    const len = data.readUInt32BE(off);
    const type = data.toString("ascii", off + 4, off + 8);
    if (off + 12 + len > data.length) {
      throw new Error(`entry.png is truncated inside chunk ${type}`);
    }
    const stored = data.readUInt32BE(off + 8 + len);
    const actual = crc32(data.subarray(off + 4, off + 8 + len));
    if (stored !== actual) {
      throw new Error(`entry.png chunk ${type} fails its CRC check`);
    }
    if (first && type !== "IHDR") {
      throw new Error("entry.png does not start with an IHDR chunk");
    }
    first = false;
    if (type === "IEND") {
      sawIend = true;
      if (off + 12 + len !== data.length) {
        throw new Error("entry.png has trailing bytes after IEND");
      }
    }
    off += 12 + len;
  }
  if (!sawIend) {
    throw new Error("entry.png has no IEND chunk");
  }
}

// IHDR chunk: width and height are big-endian uint32 at offsets 16 and 20.
const width = data.readUInt32BE(16);
const height = data.readUInt32BE(20);
if (width > MAX_DIM || height > MAX_DIM) {
  throw new Error(`entry.png is ${width}x${height}, over the 1024x1024 limit`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(dst, data);

const back = readFileSync(dst);
if (!back.equals(data)) {
  throw new Error("read-back byte compare failed");
}

const sha = createHash("sha256").update(data).digest("hex");
console.log(`wrote ${dst} (${width}x${height}, ${data.length} bytes, sha256 ${sha})`);

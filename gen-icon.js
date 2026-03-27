/**
 * Generates images/icon.png — 128×128 JobLine G-Code Intelligence icon.
 * Run with: node gen-icon.js
 * No external dependencies.
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ────────────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG chunk helper ─────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// ── Canvas ───────────────────────────────────────────────────────────────────
const W = 128, H = 128;
const img = new Uint8Array(W * H * 3); // RGB

function set(x, y, r, g, b) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = r; img[i + 1] = g; img[i + 2] = b;
}

function getPixel(x, y) {
  const i = (y * W + x) * 3;
  return [img[i], img[i + 1], img[i + 2]];
}

// Anti-alias helper: blend colour into pixel at (x,y) with weight [0..1]
function blend(x, y, r, g, b, alpha) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const [br, bg, bb] = getPixel(x, y);
  set(x, y,
    Math.round(br + (r - br) * alpha),
    Math.round(bg + (g - bg) * alpha),
    Math.round(bb + (b - bb) * alpha)
  );
}

// ── Palette ──────────────────────────────────────────────────────────────────
const BG   = [0x16, 0x1B, 0x33]; // #161B33  deep navy
const GEAR = [0x00, 0xC8, 0x82]; // #00C882  mint green
const HOLE = [0x0D, 0x11, 0x22]; // #0D1122  darker navy (center hole)
const WH   = [0xFF, 0xFF, 0xFF]; // white crosshair

// ── 1. Fill background ───────────────────────────────────────────────────────
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    set(x, y, ...BG);

// ── 2. Draw gear ─────────────────────────────────────────────────────────────
const cx = 64, cy = 64;
const outerR       = 54;   // tooth tips
const rimR         = 44;   // tooth base / gear ring outer edge
const innerR       = 30;   // gear ring inner edge
const holeR        = 9;    // center hole radius
const NUM_TEETH    = 8;
const TOOTH_HALF   = (Math.PI / NUM_TEETH) * 0.48; // angular half-width of each tooth

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx   = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Center hole
    if (dist <= holeR) { set(x, y, ...HOLE); continue; }

    // Gear ring (rimR → innerR)
    if (dist >= innerR && dist <= rimR) { set(x, y, ...GEAR); continue; }

    // Teeth (rimR → outerR), only in the angular window of each tooth
    if (dist > rimR && dist <= outerR) {
      const angle = Math.atan2(dy, dx);
      for (let t = 0; t < NUM_TEETH; t++) {
        const ta = (t / NUM_TEETH) * 2 * Math.PI;
        let diff = angle - ta;
        // Normalise diff to [-PI, PI]
        diff = diff - 2 * Math.PI * Math.floor((diff + Math.PI) / (2 * Math.PI));
        if (Math.abs(diff) <= TOOTH_HALF) { set(x, y, ...GEAR); break; }
      }
    }
  }
}

// ── 3. Crosshair inside center hole ──────────────────────────────────────────
for (let i = -(holeR - 2); i <= (holeR - 2); i++) {
  set(cx + i, cy,     ...WH);
  set(cx,     cy + i, ...WH);
}

// ── 4. Thin anti-aliased ring accent around hole ──────────────────────────────
for (let deg = 0; deg < 360; deg += 0.5) {
  const rad = deg * Math.PI / 180;
  const rx = cx + Math.cos(rad) * (holeR + 0.5);
  const ry = cy + Math.sin(rad) * (holeR + 0.5);
  blend(rx, ry, 0xFF, 0xFF, 0xFF, 0.35);
}

// ── 5. Build PNG ─────────────────────────────────────────────────────────────
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 3);
  row[0] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    const [r, g, b] = getPixel(x, y);
    row[1 + x * 3]     = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  rows.push(row);
}
const raw        = Buffer.concat(rows);
const compressed = zlib.deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W,  0);
ihdr.writeUInt32BE(H,  4);
ihdr[8]  = 8; // bit depth
ihdr[9]  = 2; // color type: RGB
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace method

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, 'images', 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Icon written → ${outPath}  (${png.length} bytes)`);

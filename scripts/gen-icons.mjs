/* 產生 PWA icon（純 Node，零依賴；產出的 PNG 已經 commit，平常不用重跑）
   用法：node scripts/gen-icons.mjs
   圖案：深底 + 金色問號（品牌色 #ffc14d），maskable 版把圖形縮到安全區內 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(OUT, { recursive: true });

const BG = [0x11, 0x14, 0x1b];
const FG = [0xff, 0xc1, 0x4d];

/* 100x100 座標系裡的「?」：上方鉤 + 中段 + 下方點 */
function inMark(x, y) {
  const cx = 50, cy = 37, ro = 23, ri = 12.5;
  const dx = x - cx, dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r <= ro && r >= ri && !(dy > -1 && dx < 1)) return true;     // 鉤（去掉左下 1/4）
  if (y >= cy + 8 && y <= 70) {                                     // 中段：從鉤的右下端拉回中線
    const t = (y - (cy + 8)) / (70 - (cy + 8));
    const mx = (cx + 17) * (1 - t) + cx * t;
    if (Math.abs(x - mx) <= 5.4) return true;
  }
  if (Math.hypot(x - cx, y - 83) <= 7) return true;                 // 點
  return false;
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 3);
  const SS = 3;                       // 3x3 超取樣當抗鋸齒
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((pxi + (sx + 0.5) / SS) / size) * 100;
          const uy = ((py + (sy + 0.5) / SS) / size) * 100;
          const mx = 50 + (ux - 50) / scale;
          const my = 50 + (uy - 50) / scale;
          if (inMark(mx, my)) hit++;
        }
      }
      const a = hit / (SS * SS);
      const o = (py * size + pxi) * 3;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  return px;
}

function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const jobs = [
  ["icon-192.png", 192, 0.86],
  ["icon-512.png", 512, 0.86],
  ["icon-180.png", 180, 0.86],
  ["icon-512-maskable.png", 512, 0.62]   // maskable：縮到安全區內，四周留白
];
for (const [name, size, scale] of jobs) {
  writeFileSync(join(OUT, name), png(size, render(size, scale)));
  console.log("written", name, size);
}

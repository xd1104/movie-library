/* 產生 PWA icon（純 Node，零依賴；產出的 PNG 已經 commit，平常不用重跑）
   用法：node scripts/gen-icons.mjs
   圖案：深底 + 金色場記板（clapperboard）。打板棒以板身左上角為軸往右上掀開、
         棒身保留一圈金色外框、裡面切斜條紋；板身上挖出品牌問號（負空間）。
   為什麼是場記板：前兩版（純問號／問號＋左右齒孔）老闆都退，理由是「看不出跟電影有關」。
         場記板是最直白的電影符號，而且輪廓不對稱，在主畫面一排圓角方塊裡才認得出來。
   小尺寸：條紋往內縮 2.6 單位是刻意的——條紋若吃到棒子邊緣，縮到 64px 會散成四根飄浮斜條。
   maskable 版把整個圖形縮到安全區內（scale 0.62），裁圓後打板棒不會被切到。 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(OUT, { recursive: true });

const BG   = [0x0b, 0x0d, 0x12];   // --bg
const GOLD = [0xff, 0xc1, 0x4d];   // --gold 品牌金

/* ---------- 幾何工具（全部在 100x100 座標系） ---------- */
const RAD = Math.PI / 180;
function rrect(x, y, x0, y0, x1, y1, r = 0) {          // 圓角矩形
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const px = Math.abs(x - cx) - (hx - r), py = Math.abs(y - cy) - (hy - r);
  return Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r <= 0;
}
function segd(px, py, ax, ay, bx, by) {                 // 點到線段距離
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}
function rot(x, y, cx, cy, deg) {                       // 把取樣點反旋轉 = 圖形旋轉
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c + dy * s, cy - dx * s + dy * c];
}

/* ---------- 問號（負空間用）----------
   local 座標：100 單位高、以 x=0 為中軸；上鉤 + 尾巴 + 點 */
function qmarkLocal(x, y, t) {
  const cy = 30, r = 26;
  if (Math.abs(Math.hypot(x, y - cy) - r) <= t / 2) {
    const a = (Math.atan2(y - cy, x) / RAD + 360) % 360;   // 0=右 90=下 180=左 270=上
    if (a >= 158 || a <= 62) return true;                   // 缺口留在左下
  }
  const ex = r * Math.cos(62 * RAD), ey = cy + r * Math.sin(62 * RAD);
  if (segd(x, y, ex, ey, 0, 72) <= t / 2) return true;      // 尾巴拉回中軸
  if (Math.hypot(x, y - 92) <= t / 2 + 1.5) return true;    // 點
  return false;
}
function qmark(x, y, cx, cy, h, t = 17) {
  return qmarkLocal(((x - cx) / h) * 100, ((y - (cy - h / 2)) / h) * 100, t);
}

/* ---------- 場記板 ---------- */
const BOARD_T = 40;                                    // 板身上緣，也是打板棒的旋轉軸高度
function inMark(x, y) {
  let gold = rrect(x, y, 13, BOARD_T, 87, 85, 7);      // 板身
  if (y <= BOARD_T + 1) {                              // 打板棒：以板身左上角為軸往右上掀開
    const [rx, ry] = rot(x, y, 13, BOARD_T, -15);
    if (rrect(rx, ry, 13, BOARD_T - 19.5, 88, BOARD_T, 4)) {
      gold = true;
      if (rrect(rx, ry, 15.6, BOARD_T - 16.9, 85.4, BOARD_T, 2)) {   // 條紋內縮，留一圈外框
        const u = rx - (ry - (BOARD_T - 19.5)) * 0.5;                // 斜條紋
        if (((u - 22) % 18.6 + 18.6) % 18.6 < 9) return false;
      }
    }
  }
  if (!gold) return false;
  if (qmark(x, y, 50, 62.5, 37)) return false;         // 板身上挖問號
  return true;
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 3);
  const SS = 4;                       // 4x4 超取樣當抗鋸齒
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((pxi + (sx + 0.5) / SS) / size) * 100;
          const uy = ((py + (sy + 0.5) / SS) / size) * 100;
          if (inMark(50 + (ux - 50) / scale, 50 + (uy - 50) / scale)) hit++;
        }
      }
      const a = hit / (SS * SS), o = (py * size + pxi) * 3;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - a) + GOLD[c] * a);
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

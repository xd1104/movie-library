#!/usr/bin/env node
/* ============================================================
   inline-boot.js — 把 splash-boot.js 的內容「逐字」貼進 index.html 的柵欄裡
   ------------------------------------------------------------
   用法（在專案根目錄）：
     node motion/inline-boot.js                       改 index.html，來源 motion/splash-boot.js
     node motion/inline-boot.js public/index.html js/splash-boot.js
     node motion/inline-boot.js --check               只檢查有沒有分岔（不寫檔，分岔就 exit 1）

   為什麼要 inline（2026-08-27）：
     第一次繪製之前必須到齊的**同源請求數**，外部 script 是 2 個
     （index.html ＋ splash-boot.js），inline 之後是 1 個。
     桌機量不出差別（Service Worker 派送幾乎免費），但 iPhone 從主畫面開 PWA 時
     每一個經過 SW 的子資源都要付一次 WKWebView 的代價 —— 那正是這一版在賭的東西。

   ⚠️ 為什麼是「逐字」不是「剝掉註解再壓縮」：
     splash-boot.js 裡有 "https://xd1104.github.io/..." 這種**字串裡的 //**，
     天真的註解剝除器會把它當成行註解、把後面整段吃掉。
     而剝除器只要在**寬鬆的方向**出錯，守衛就會在「程式其實已經分岔」時放行 ——
     那是最糟的失敗模式（尺壞了但一片綠）。
     代價只是 index.html 多幾 KB（而且它本來就在殼快取裡），比一把會說謊的尺便宜太多。
   ============================================================ */
"use strict";
var fs = require("fs");
var path = require("path");

var BEGIN = "<!-- SPLASH-BOOT-INLINE:BEGIN";
var END = "<!-- SPLASH-BOOT-INLINE:END -->";

var args = process.argv.slice(2);
var CHECK = args.indexOf("--check") >= 0;
var rest = args.filter(function (a) { return a.indexOf("--") !== 0; });
var HERE = __dirname;
var ROOT = path.resolve(HERE, "..");
var htmlPath = path.resolve(process.cwd(), rest[0] || path.join(ROOT, "index.html"));
var bootPath = path.resolve(process.cwd(), rest[1] || path.join(HERE, "splash-boot.js"));

function die(msg) { console.error("[inline-boot] " + msg); process.exit(1); }

var html, boot;
try { html = fs.readFileSync(htmlPath, "utf8"); } catch (e) { die("讀不到 " + htmlPath); }
try { boot = fs.readFileSync(bootPath, "utf8"); } catch (e) { die("讀不到 " + bootPath); }

/* 逐字貼進 <script> 裡的兩個致命字串：有的話 HTML 解析器會提早關掉 script，
   整段程式碼會變成畫面上的文字。守衛擋在這裡，不要等到上線才發現。 */
if (/<\/script/i.test(boot)) die("splash-boot.js 裡出現 </script（inline 之後會把 script 提早關掉）");
if (boot.indexOf("<!--") >= 0 || boot.indexOf("-->") >= 0) die("splash-boot.js 裡出現 <!-- 或 -->（會跟柵欄註解打架）");

var iB = html.indexOf(BEGIN);
var iE = html.indexOf(END);
if (iB < 0 || iE < 0 || iE < iB) {
  die("index.html 裡找不到柵欄。要長這樣：\n" +
      "  " + BEGIN + " … -->\n  <script>\n  …\n  </script>\n  " + END);
}

/* 換行正規化：比對一律在 LF 空間做（這台機器有的 repo 是 CRLF、範本是 LF，
   不正規化的話只要 git 重新簽出一次就會「紅在行尾」而不是「紅在程式分岔」）。 */
var toLF = function (s) { return s.replace(/\r\n/g, "\n"); };
var block = html.slice(iB, iE + END.length);
var m = /<script>\r?\n([\s\S]*?)<\/script>/.exec(block);
var cur = m ? toLF(m[1]) : null;
var want = toLF(boot);

if (CHECK) {
  if (cur === null) die("柵欄裡沒有 <script>…</script>");
  if (cur !== want) die("index.html 的 inline 副本跟 " + path.relative(ROOT, bootPath) + " 已經分岔了，跑一次 `node motion/inline-boot.js` 重貼");
  console.log("[inline-boot] 一致 ✓（" + want.length + " 字元）");
  process.exit(0);
}

if (cur === want) { console.log("[inline-boot] 本來就一致，沒有改動"); process.exit(0); }

/* 寫回時換成原檔的換行風格（不要把整份 index.html 的行尾換掉） */
var crlf = html.indexOf("\r\n") >= 0;
var body = crlf ? want.replace(/\n/g, "\r\n") : want;
var nl = crlf ? "\r\n" : "\n";
var head = block.slice(0, block.indexOf("<script>"));
var neo = head + "<script>" + nl + body + "</script>" + nl + END;
fs.writeFileSync(htmlPath, html.slice(0, iB) + neo + html.slice(iE + END.length), "utf8");
console.log("[inline-boot] 已把 " + path.relative(ROOT, bootPath) + " 逐字貼進 " + path.relative(ROOT, htmlPath));

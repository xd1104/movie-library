/* 動效基調（沉穩）＋ 開場畫面（印記）— 2026-08-25 lab-ux 定案、PM 拍板。
   ------------------------------------------------------------------
   ⚠️ 這支測試刻意用「掃描全部並逐一驗」而不是「列出我想到的那幾個」：
      上一輪範本那邊的退件幾乎全是同一種病 —— 保證是對的，但涵蓋範圍比宣稱的小，
      而且不會報錯（觸控目標列白名單漏第 5 顆、守衛只掃 inline 不掃外部檔…）。
      所以每一條掃描式斷言都配一個「掃到少於 N 個就代表尺壞了」的自證，
      以及一個負控組（故意拿一個不該命中的東西，證明比對真的會回 false）。 */
import { boot, tick, $, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const read = f => fs.readFileSync(R + f, "utf8");
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };

const IDX = read("index.html");
const MOTION = read("css/motion.css");
const APPCSS = read("css/app.css");
const SPLASHCSS = read("css/splash.css");
const SPLASHJS = read("js/splash.js");
const APPJS = read("js/app.js");
const SW = read("sw.js");
const MF = JSON.parse(read("manifest.webmanifest"));

/* 去掉註解再做結構分析（註解裡寫滿了「不要用 animationend」「不要掛 pageshow」這種字，
   不剝掉的話會拿註解當程式碼誤判 —— 那正是「守衛看不到的東西要講出來」的反面教材）。
   只剝 /* *\/ 區塊，以及整行就是註解的 //，避免傷到字串裡的 https:// */
const noComment = s => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
const MOTION_C = noComment(MOTION);
const SPLASHJS_C = noComment(SPLASHJS);
const APPJS_C = noComment(APPJS);
const NOWS = s => s.replace(/\s+/g, "");

/* 從 index.html 裡把那段 inline 的 SPLASH_CONFIG 挖出來（要在 jsdom 裡真的跑它） */
const CFG_SRC = (/<script>\s*([\s\S]*?window\.SPLASH_CONFIG[\s\S]*?)<\/script>/.exec(IDX) || [])[1] || "";

/* WCAG 對比度（跟 splash.js 的 relLum 同一套，但這裡是「獨立實作」，
   刻意不從 splash.js 匯入——用被測程式自己的算式去驗自己，等於什麼都沒驗） */
function lum(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const c = [0, 2, 4].map(i => {
    const v = parseInt(h.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* 讓 jsdom 也跑 SPLASH_CONFIG ＋ js/splash.js（harness 會把所有 <script src> 拿掉，
   所以平常 t1～t13 都是在「沒有 Splash」的狀態下跑的 ＝ 天然負控組）。 */
function withSplash(extra) {
  return function (w) {
    if (extra) extra(w);
    w.eval(CFG_SRC);
    w.eval(SPLASHJS);
  };
}

/* ================================================================
   §60 開場底色：四個地方必須逐字一致
   （不一致的症狀是「iPhone 從主畫面開 App 會白閃一下」——
     那是 iOS 先畫一張 background_color 的系統開場，關不掉。
     在電腦上永遠看不到，也不會有人回報，所以一定要機器比對。）
   ================================================================ */
section("60. 開場底色四處逐字一致（manifest 不用改的前提就是這一條）");
{
  const cssBg = (/--splash-bg:\s*(#[0-9a-fA-F]{3,8})/.exec(IDX) || [])[1];
  const meta = (/<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})">/.exec(IDX) || [])[1];
  const cfgBg = (/bg:\s*"(#[0-9a-fA-F]{3,8})"/.exec(IDX) || [])[1];
  const appBg = (/--bg:\s*(#[0-9a-fA-F]{6})/.exec(APPCSS) || [])[1];
  ok(!!cssBg && !!meta && !!cfgBg && !!MF.background_color && !!appBg,
    "四個來源都讀得到（尺沒壞）：" + [cssBg, meta, cfgBg, MF.background_color, appBg].join(" / "));
  ok(cssBg === MF.background_color,
    "★ index.html 的 --splash-bg === manifest.background_color（" + cssBg + " / " + MF.background_color + "）");
  ok(cssBg === meta, "★ 也 === <meta theme-color>（" + meta + "）");
  ok(cssBg === cfgBg, "★ 也 === SPLASH_CONFIG.defaults.bg（" + cfgBg + "）");
  ok(cssBg === appBg, "★ 也 === app.css 的 --bg（" + appBg + "）→ 收場之後不會有色差");
  ok(MF.theme_color === cssBg, "manifest.theme_color 也一樣");
  /* 負控組：證明這個比對真的會失敗，不是恆真 */
  ok(cssBg !== "#123456", "負控：拿一個不一樣的色碼比，結果必須是「不相等」");
}

section("61. 開場外觀＝這支 App 自己的品牌（不是範本的預設值）");
{
  ok(/glyph:\s*"雷"/.test(IDX), "★ 符號是「雷」");
  ok(/name:\s*"好雷嗎\?"/.test(IDX), "★ 名字是「好雷嗎?」");
  ok(/tagline:\s*"一頁看完值不值得看"/.test(IDX), "★ 標語是「一頁看完值不值得看」");
  const acc = (/--splash-accent:\s*(#[0-9a-fA-F]{6})/.exec(IDX) || [])[1];
  const ink = (/--splash-ink:\s*(#[0-9a-fA-F]{6})/.exec(IDX) || [])[1];
  ok(acc === (/--gold:\s*(#[0-9a-fA-F]{6})/.exec(APPCSS) || [])[1], "★ accent === app.css 的 --gold（" + acc + "）");
  ok(ink === (/--text:\s*(#[0-9a-fA-F]{6})/.exec(APPCSS) || [])[1], "★ ink === app.css 的 --text（" + ink + "）");
  ok(!/範|App 範本|#241f1b|#b2592b/.test(CFG_SRC), "★ 沒有留下範本的預設值（範／App 範本／#241f1b／#b2592b）");
  ok(/appId:\s*"movie-library"/.test(IDX) && /krAppId: "movie-library"/.test(read("js/config.js")),
    "★ 開場的 appId 跟鑰匙圈的 krAppId 是同一個（movie-library）");
  ok(!/on-accent|onAccent/.test(CFG_SRC), "★ 符號字色不是設定項（設定裡沒有它，由 onColor 算）");

  /* ⭐ 全掃描：css/splash.css 是範本的複製品，它 :root 裡每一個 --splash-* 的預設值都是**範本的品牌**
     （範／App 範本／#241f1b…）。只要有一個沒在 index.html 蓋掉，
     「splash.js 載不到但 splash.css 載到了」的那一次，畫面上就會出現別人家的品牌。
     所以這裡不是列白名單，是把 splash.css 宣告的每一個都掃出來逐一驗。
     唯一的例外是 --splash-on-accent：它刻意由 onColor() 算，不是設定項。 */
  const styleBlock = (/<style>([\s\S]*?)<\/style>/.exec(IDX) || ["", ""])[1];
  const styleCss = noComment(styleBlock);   /* 註解裡也會寫到「範本」與 --splash-bg，一定要先剝掉 */
  const declared = [...new Set([...noComment(SPLASHCSS).matchAll(/(--splash-[a-z-]+)\s*:/g)].map(m => m[1]))];
  ok(declared.length >= 6, "★ splash.css 宣告了 " + declared.length + " 個 --splash-* 變數（少於 6 就是掃描壞了）");
  for (const v of declared) {
    if (v === "--splash-on-accent") {
      ok(styleCss.indexOf(v) < 0, "★ " + v + " 刻意不在落地設定裡（由 onColor 算）");
      continue;
    }
    ok(styleCss.indexOf(v + ":") >= 0, "★ " + v + " 在 index.html 被蓋成我們自己的品牌");
  }
  ok(!/範|#241f1b|#b2592b/.test(styleCss), "★ 落地那一塊裡沒有範本的值");
}

/* ================================================================
   §62 載入順序與 script 形態
   ================================================================ */
section("62. 載入順序（錯了就會「先畫預設再跳字」或 token 拿不到）");
{
  const iApp = IDX.indexOf('href="./css/app.css"');
  const iMo = IDX.indexOf('href="./css/motion.css"');
  const iSp = IDX.indexOf('href="./css/splash.css"');
  const iCfg = IDX.indexOf("window.SPLASH_CONFIG");
  const iJs = IDX.indexOf('src="./js/splash.js"');
  const iHead = IDX.indexOf("</head>");
  const iAppJs = IDX.indexOf('src="./js/app.js"');
  ok(iApp >= 0 && iMo >= 0 && iSp >= 0 && iCfg >= 0 && iJs >= 0, "五個東西都在（尺沒壞）");
  ok(iApp < iMo, "★ app.css 在 motion.css 之前（同權重時後宣告者勝，動效才蓋得過既有規則）");
  ok(iMo < iSp, "★ motion.css 在 splash.css 之前（splash 要吃 --dur-* token）");
  ok(iCfg < iJs, "★ SPLASH_CONFIG 在 splash.js 之前");
  ok(iJs < iHead, "★ splash.js 在 </head> 之前（body 還沒解析就把外觀設好）");
  ok(iJs < iAppJs, "★ splash.js 在 app.js 之前");
  /* ⚠️ 這裡要抓整個標籤再驗屬性，**不可以寫成「src 後面不准接 defer」**：
     `<script defer src="…">` 屬性順序一換就繞過去了。
     （2026-08-25 突變測試 X15 實抓：第一版就是這樣寫的，127 條裡唯一沒守住的就是它。） */
  const spTag = (/<script[^>]*src="\.\/js\/splash\.js"[^>]*>/.exec(IDX) || [""])[0];
  ok(!!spTag, "撈得到 splash.js 那個 script 標籤（尺沒壞）：" + spTag);
  ok(!/\b(defer|async|type="module")\b/.test(spTag),
    "★ 是同步 script，沒有 defer／async／module（有的話就不保證「不會中途換字」）", spTag);
  ok(/<div id="splash" aria-hidden="true">/.test(IDX), "body 最前面有 #splash（而且 aria-hidden）");
  ok(/<div class="sp-glyph"><\/div>/.test(IDX) && /<div class="sp-name"><\/div>/.test(IDX),
    "★ 符號與名字的元素刻意是空的（文字由 CSS content 畫，才不會先畫預設再換）");
}

/* ================================================================
   §63 SW 殼快取：全掃描，不是列白名單
   （範本那輪的災情：模組載不到 → 開場永遠卡在螢幕上，
     而保險絲就住在那支沒載到的檔案裡。）
   ================================================================ */
section("63. index.html 引用的每一個本站 css/js 都要在 sw.js 殼快取裡（全掃描）");
{
  const refs = [...IDX.matchAll(/(?:href|src)="(\.\/(?:css|js)\/[^"]+)"/g)].map(m => m[1]);
  const files = [...(/var FILES = \[([\s\S]*?)\];/.exec(SW)[1]).matchAll(/"([^"]+)"/g)].map(m => m[1]);
  ok(refs.length >= 7, "★ 掃到 " + refs.length + " 個本站資源（少於 7 就是掃描壞了）：" + refs.join(", "));
  for (const r of refs) ok(files.indexOf(r) >= 0, "★ " + r + " 有進殼快取");
  /* 負控組：證明這個比對會失敗 */
  ok(files.indexOf("./css/__not-there__.css") < 0, "負控：不存在的檔案比對結果必須是「不在清單裡」");
  ok(files.indexOf("./css/motion.css") >= 0 && files.indexOf("./js/splash.js") >= 0,
    "動效與開場那三個新檔在清單裡");
}

section("64. 呼叫端的守衛：Splash 載不到也不可以把 App 弄死");
{
  ok(/window\.Splash && window\.Splash\.hold && window\.Splash\.ready/.test(APPJS),
    "★ 用 window.Splash && … 判斷有沒有這個模組");
  /* 全掃描：app.js 裡每一處碰到 Splash. 的地方，都必須在 try 裡而且先問過 window.Splash */
  const lines = APPJS_C.split("\n").map((l, i) => ({ n: i + 1, l }))
    .filter(x => /(^|[^\w.])Splash\./.test(x.l));
  ok(lines.length >= 2, "★ 掃到 " + lines.length + " 處 Splash. 存取（少於 2 就是掃描壞了）");
  for (const x of lines) {
    ok(/try \{/.test(x.l) && /(window\.Splash|hasSplash)/.test(x.l),
      "★ 每一處 Splash. 存取都有 try/catch ＋ 先問過 window.Splash", x.l.trim());
  }
  ok(/function splashFallback\(\)/.test(APPJS), "有 splashFallback()");
  ok(/removeChild\(sp\)/.test(APPJS) && /data-splash", "off"/.test(APPJS),
    "★ fallback 會把 #splash 從 DOM 拿掉（全螢幕的東西卡住＝App 打不開）");
  ok(/addEventListener\("touchstart"/.test(APPJS),
    "★ fallback 也補上 touchstart（沒有它 iOS 的 :active 全部是死的）");
  ok(/splashReady\(\)/.test(APPJS), "有 splashReady()");
  const rd = (APPJS.match(/splashReady\(\);/g) || []).length;
  ok(rd >= 6, "★ 每一條「畫面畫好了」的出口都叫了 splashReady（" + rd + " 處：片單成功／失敗／逃生門／詳細頁三條／設定頁）");
}

/* ================================================================
   §65 動效 token：數值逐字照定案的「沉穩」那一組
   ================================================================ */
section("65. 動效 token（沉穩，逐字）");
{
  const rootBlock = (/:root\{([\s\S]*?)\}/.exec(MOTION_C) || [])[1] || "";
  const TOK = {
    "--dur-press": "120ms", "--dur-1": "180ms", "--dur-2": "280ms", "--dur-3": "420ms",
    "--ease": "cubic-bezier(.22,.61,.36,1)", "--ease-in": "cubic-bezier(.45,0,.9,.4)",
    "--ease-press": "cubic-bezier(.2,0,.2,1)", "--ease-page": "cubic-bezier(.22,.61,.36,1)",
    "--lift": "10px", "--lift-lg": "20px",
    "--scale-in": ".985", "--press": ".985", "--press-lg": ".96",
    "--stagger": "45ms", "--hold-toast": "2400ms"
  };
  const got = {};
  for (const m of rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) got[m[1]] = m[2].trim();
  ok(Object.keys(got).length === Object.keys(TOK).length,
    "★ :root 裡剛好 " + Object.keys(TOK).length + " 個變數（實際 " + Object.keys(got).length + "）");
  for (const k of Object.keys(TOK)) ok(got[k] === TOK[k], "★ " + k + " = " + TOK[k] + "（實際 " + got[k] + "）");
  /* ⭐ 白名單：motion.css 只准宣告上面那幾個變數。
     這條在擋「哪天有人整包把範本的 motion.css 抄進來」——
     範本那份的 --bg / --surface / --muted / --line 跟這支 App 撞名，會把配色整個蓋掉。 */
  const declared = [...MOTION_C.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
  const bad = [...new Set(declared)].filter(k => !(k in TOK));
  ok(bad.length === 0, "★ motion.css 沒有宣告任何 token 以外的變數（撞名的色票會蓋掉配色）", bad.join(", "));
  ok(declared.length >= 15, "掃到 " + declared.length + " 個變數宣告（尺沒壞）");
}

section("66. motion.css 一個顏色都沒有");
{
  const hex = MOTION_C.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok(hex.length === 0, "★ 沒有任何色碼", hex.join(", "));
  ok(!/(?:^|[^-])\bcolor\s*:/.test(MOTION_C) && !/background(-color)?\s*:/.test(MOTION_C),
    "★ 也沒有 color／background 宣告（配色一律以 app.css 為準）");
  /* 負控組：同一支正則拿去掃 app.css 一定要抓到一堆，否則是正則寫壞了 */
  ok((noComment(APPCSS).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length > 20,
    "負控：同一條正則掃 app.css 抓得到色碼（證明它真的在找東西）");
}

section("67. 進場動畫一律 backwards（用 both／forwards 會永久殺掉 :active）");
{
  const anims = [...MOTION_C.matchAll(/animation\s*:\s*([^;]+);/g)].map(m => m[1]);
  ok(anims.length >= 5, "★ 掃到 " + anims.length + " 條 animation 簡寫（少於 5 就是掃描壞了）");
  const wrong = anims.filter(a => /\b(both|forwards)\b/.test(a));
  ok(wrong.length === 0, "★ 沒有任何一條用 both／forwards", wrong.join(" | "));
  ok(anims.filter(a => /\bbackwards\b/.test(a)).length >= 5, "★ 而且都明寫了 backwards");
  /* 開場那一區是例外：#splash 不可互動，收場本來就要停在最終狀態 */
  ok(/#splash\.out\{[\s\S]*?forwards/.test(noComment(SPLASHCSS)),
    "對照：splash.css 的收場用 forwards（開場不可互動，是安全的）");
  /* reduced-motion 只歸零 token，不改元件規則 */
  const red = (/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)$/.exec(MOTION_C) || [])[1] || "";
  for (const k of ["--dur-press:1ms", "--dur-1:1ms", "--dur-2:1ms", "--dur-3:1ms", "--stagger:0ms", "--press:1", "--press-lg:1", "--lift:0px"])
    ok(red.replace(/\s/g, "").includes(k.replace(/\s/g, "")), "★ 減少動態時 " + k);
  ok(/\.skel\{animation:none;\}/.test(red.replace(/\s+/g, "")) || /\.skel\{animation:none/.test(red),
    "★ 減少動態時 shimmer 要關掉（持續型動作，歸零 token 關不掉它）");
}

/* ================================================================
   §68 按下回饋：把畫面上每一個可點的東西掃出來逐一驗
   （不是列白名單——上一輪就是列白名單漏了第 5 顆。）
   ================================================================ */
section("68. 每一個可點的元素都有 :active 縮放（全掃描 + 負控）");
{
  /* 從 motion.css 撈出所有「:active 且真的有 transform:scale」的選擇器 */
  const PRESS = [];
  for (const m of MOTION_C.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/transform\s*:\s*scale\(/.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (s.endsWith(":active")) PRESS.push(s.slice(0, -":active".length).trim());
    }
  }
  ok(PRESS.length >= 10, "★ 撈到 " + PRESS.length + " 條 :active 縮放規則（少於 10 就是解析壞了）");

  const CLICKABLE = "button, a[href], [data-open], [data-pf], [data-kw], [data-act], [data-sub], [data-tab], [data-del]";
  const { w, d } = await boot({ store: ST, mock: {} });
  await tick(w, 200);
  const seen = [];
  function sweep(where) {
    const els = [...d.querySelectorAll(CLICKABLE)].filter(e => !e.closest("#splash"));
    for (const el of els) {
      const sig = where + " " + el.tagName.toLowerCase() +
        (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : "");
      seen.push(sig);
      ok(PRESS.some(s => el.matches(s)), "★ " + sig + " 有按下回饋");
    }
    return els.length;
  }
  const nHome = sweep("首頁");
  /* 詳細頁（含 PTT 卡與底部返回鈕） */
  d.querySelector(".row[data-open]").click();
  await tick(w, 400);
  const nDetail = sweep("詳細頁");
  /* 設定頁 */
  $(d, "back").click(); await tick(w, 120);
  $(d, "gear").click(); await tick(w, 150);
  const nSetup = sweep("設定頁");
  ok(nHome >= 8 && nDetail >= 5 && nSetup >= 8,
    "★ 三個畫面各掃到 " + nHome + " / " + nDetail + " / " + nSetup + " 個可點元素（太少就是根本沒掃到）");
  ok(new Set(seen).size >= 15, "★ 去重後共 " + new Set(seen).size + " 種可點元素被驗過");

  /* 負控組一：一個不存在的 class 一定要「不命中」，證明比對不是恆真 */
  const fake = d.createElement("button");
  fake.className = "__nope__";
  d.body.appendChild(fake);
  ok(!PRESS.some(s => fake.matches(s)), "★ 負控：沒有樣式的按鈕不命中任何 :active 規則");
  fake.remove();
  /* 負控組二：平台標籤是資訊不是按鈕（CLAUDE.md 第 9 條），不可以有按下回饋 */
  d.querySelector(".row[data-open]") && null;
}

section("68b. 平台標籤不可以被誤加按下回饋（CLAUDE.md 第 9 條）");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 150);
  d.querySelector(".row[data-open]").click();
  await tick(w, 400);
  const pv = d.querySelector(".pv");
  ok(!!pv, "詳細頁上找得到平台標籤（尺沒壞）");
  ok(pv.tagName.toLowerCase() === "span" && !pv.matches("button, a"), "★ 它是 span、不是按鈕");
  ok(/\.pv,\.pv:active\{transform:none;\}/.test(MOTION_C.replace(/\s+/g, "")),
    "★ motion.css 明寫它沒有按下回饋");
}

/* ================================================================
   §69 清單錯開進場
   ================================================================ */
section("69. 搜尋結果／片單錯開進場，而且有上限");
{
  ok(/#list > \.row\{[\s\S]*?animation:hlm-item-in var\(--dur-2\) var\(--ease\) backwards;/.test(MOTION_C),
    "★ #list 的每一列都播 hlm-item-in");
  const delays = [...MOTION_C.matchAll(/#list > \.row:nth-child\(([^)]+)\)\{animation-delay:([^;]+);/g)];
  ok(delays.length === 12, "★ 12 條錯開規則（1～11 加上 n+12 的上限），實際 " + delays.length);
  ok(delays[delays.length - 1][1] === "n+12", "★ 最後一條是 :nth-child(n+12)（第 13 筆以後不再往後排）");
  ok(/calc\(var\(--stagger\) \* 11\)/.test(delays[delays.length - 1][2]),
    "★ 上限停在 11 × stagger（約 495ms），不會讓第 20 筆等快一秒");
  /* 骨架卡片也是 .row，所以載入中就已經在錯開淡入 */
  const { w, d } = await boot({ store: ST, mock: {}, delay: {} });
  await tick(w, 5);
  ok(/class="row"/.test(html(d, "list")) || /skel/.test(html(d, "list")), "載入中放的是骨架卡（不是空白）");
  await tick(w, 250);
  ok(d.querySelectorAll("#list > .row").length === 6, "★ 資料到了換成 6 張真卡片（同樣吃 nth-child 錯開）");
}

/* ================================================================
   §70 進出詳細頁的 push / pop
   ================================================================ */
section("70. 進詳細頁 push、返回 pop，方向相反");
{
  ok(/#view-detail\.on,\s*#view-setup\.on\{[\s\S]*?animation:hlm-page-in/.test(MOTION_C), "★ 進去用 hlm-page-in");
  ok(NOWS(MOTION_C).includes("@keyframeshlm-page-in{from{opacity:0;transform:translateX(var(--lift-lg));}"),
    "★ 從右邊（+lift-lg）推進來");
  ok(NOWS(MOTION_C).includes("@keyframeshlm-page-pop{from{opacity:0;transform:translateX(calc(var(--lift-lg)*-1));}"),
    "★ 返回時首頁從左邊（-lift-lg）回來 —— 方向跟進去相反");
  ok(NOWS(MOTION_C).includes("#app{overflow-x:clip;}"),
    "★ #app 用 overflow-x:clip 收掉那 20px（用 hidden 會讓 sticky 黏錯對象）");

  const { w, d } = await boot({ store: ST });
  await tick(w, 200);
  ok(!$(d, "view-home").classList.contains("pop"), "★ 開機那次不播 pop（開場的 .boot 已經在演了）");
  d.querySelector(".row[data-open]").click(); await tick(w, 250);
  ok($(d, "view-detail").classList.contains("on"), "進得了詳細頁");
  $(d, "back").click(); await tick(w, 150);
  ok($(d, "view-home").classList.contains("pop"), "★ 從詳細頁返回 → 首頁掛上 .pop");
  ok(!$(d, "view-detail").classList.contains("on"), "詳細頁收起來了");
  /* 再進再出一次：class 要能重播（remove → 強制回流 → add） */
  d.querySelector(".row[data-open]").click(); await tick(w, 250);
  $(d, "back").click(); await tick(w, 150);
  ok($(d, "view-home").classList.contains("pop"), "★ 第二次返回照樣掛得上（重播動畫的正規做法）");
  /* 設定頁也走同一條路 */
  $(d, "gear").click(); await tick(w, 120);
  ok($(d, "view-setup").classList.contains("on"), "設定頁也用 .on（吃同一條 hlm-page-in）");
}

/* ================================================================
   §71 開場的行為（真的跑 js/splash.js）
   ================================================================ */
section("71. 開場：冷啟動播、收得掉、收掉之後從 DOM 移除");
{
  const { w, d } = await boot({ store: ST, beforeEval: withSplash() });
  ok(!!w.Splash, "★ 模組載進來了（有 window.Splash）");
  ok(w.Splash.state().cold === true, "★ 這是冷啟動");
  ok(!!d.getElementById("splash"), "開場一開始在畫面上");
  ok(w.document.documentElement.style.getPropertyValue("--splash-name") === '"好雷嗎?"',
    "★ 名字在 head 就寫成 CSS 變數了（不可能先畫預設再換字）");
  ok(w.document.documentElement.style.getPropertyValue("--splash-glyph") === '"雷"', "★ 符號也是");
  await tick(w, 400);
  ok(!!d.getElementById("splash"), "★ 資料還沒到（400ms）時開場還在，蓋住等待");
  await tick(w, 900);
  ok(!d.getElementById("splash"), "★ 資料到了就收，而且是從 DOM remove 掉（不是 hidden）");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ 收掉之後片單是好的（開場沒有拖慢也沒有擋住）");
  ok(w.Splash.state().dismissed === true, "state() 也說收掉了");
  ok(w.Splash.state().elapsed >= 650, "★ 最短顯示 650ms 有守住（實際 " + w.Splash.state().elapsed + "ms）");
}

section("71b. 熱啟動不重播（切分頁、返回、重新整理同一個 session）");
{
  const { w, d } = await boot({
    store: ST,
    beforeEval: withSplash(win => { win.sessionStorage.setItem("splash-seen:movie-library:1", "1"); })
  });
  ok(w.Splash.state().cold === false, "★ 判定成熱啟動");
  ok(w.document.documentElement.getAttribute("data-splash") === "off",
    "★ 在 head 就把 html[data-splash=off] 設好 —— 連一幀都不會被畫出來");
  await tick(w, 120);
  ok(!d.getElementById("splash"), "★ 開場節點直接不存在");
  await tick(w, 200);
  ok(d.querySelectorAll(".row[data-open]").length === 6, "片單照常");
  ok(!/visibilitychange|pageshow/.test(SPLASHJS_C), "★ 沒有掛在 visibilitychange／pageshow 上重播");
  ok(/sessionStorage/.test(SPLASHJS_C) && !/localStorage\.getItem\(SEEN_KEY\)/.test(SPLASHJS_C),
    "★ 冷啟動判斷用 sessionStorage（localStorage 會變成一輩子只播一次）");
}

section("71c. 減少動態：開場照樣收得掉，而且縮短");
{
  const { w, d } = await boot({
    store: ST,
    beforeEval: withSplash(win => {
      win.matchMedia = q => ({ matches: /prefers-reduced-motion/.test(q), media: q, addListener() { }, removeListener() { } });
    })
  });
  ok(w.Splash.state().reduce === true, "★ 偵測到「減少動態」");
  ok(w.Splash.state().minShow === 300, "★ 最短顯示縮成 300ms（不然會盯著一張靜止畫面）");
  await tick(w, 600);
  ok(!d.getElementById("splash"), "★ 開場收得掉（全螢幕的東西卡住＝App 打不開）");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ 流程走得完，片單出得來");
}

section("71d. 保險絲：app 永遠不叫 ready() 也一定會收");
{
  /* 讓片單請求永遠不回來 ⇒ splashReady() 不會被呼叫 ⇒ 只剩保險絲能救 */
  const { w, d } = await boot({
    store: ST,
    beforeEval: withSplash(win => {
      const real = win.fetch;
      win.fetch = u => (/themoviedb|omdbapi/.test(String(u)) ? new Promise(() => { }) : real(u));
    })
  });
  ok(!!d.getElementById("splash"), "開場在（資料永遠不會回來）");
  await tick(w, 1500);
  ok(!!d.getElementById("splash"), "★ 1.5 秒時還在（證明它真的在等，不是提早走）");
  await tick(w, 5200);
  ok(!d.getElementById("splash"), "★ 6 秒保險絲一到就收 —— 不管發生什麼，開場一定會消失");
  ok(/W\.setTimeout\(function \(\) \{ dismiss\(\); \}, FUSE\);/.test(SPLASHJS) &&
    /W\.setTimeout\(function \(\) \{ hardRemove\(\); \}, FUSE \+ 1500\);/.test(SPLASHJS),
    "★ 而且是兩條互相獨立的保險絲（收場 + 硬移除）");
  ok(!/animationend/.test(SPLASHJS_C), "★ 收屍不掛 animationend（沒觸發＝整個 App 打不開）");
}

section("71e. 沒有 splash.js 的時候（離線、部署漏檔）App 一樣完整可用");
{
  /* 這就是 harness 的預設狀態：所有 <script src> 都被拿掉 ⇒ window.Splash 不存在 */
  const { w, d } = await boot({ store: ST });
  await tick(w, 250);
  ok(!w.Splash, "沒有 window.Splash（模擬那支檔案載不到）");
  ok(!d.getElementById("splash"), "★ fallback 自己把 #splash 收掉了（不會永遠卡在螢幕上）");
  ok(d.documentElement.getAttribute("data-splash") === "off", "html[data-splash=off] 也設好了");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ 片單完整出得來（IIFE 沒有中止）");
  $(d, "q").value = "沙丘";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 200);
  ok(/搜尋結果/.test($(d, "listTitle").textContent), "★ 搜尋照樣有反應（事件都掛上了）");
}

/* ================================================================
   §72 符號字色：算出來的，而且最差有下界
   ================================================================ */
section("72. 符號字色由 onColor() 算，不是設定項，也不可以寫死白字");
{
  const cases = [
    ["#ffc14d", "我們自己的 accent（金）"],
    ["#00d038", "飽和的綠 —— 舊的「亮度 > 門檻」算法在這裡只有 2.08:1"],
    ["#438c83", "全色域最差的那個色（範本實測 3.95:1）"],
    ["#ffffff", "純白"],
    ["#000000", "純黑"]
  ];
  for (const [acc, why] of cases) {
    const { w } = await boot({
      store: ST,
      rawStore: { "splash:movie-library": JSON.stringify({ accent: acc }) },
      beforeEval: withSplash()
    });
    const on = w.document.documentElement.style.getPropertyValue("--splash-on-accent");
    const cr = contrast(on, acc);
    ok(/^#[0-9a-f]{6}$/i.test(on), "算得出字色：" + acc + " → " + on + "（" + why + "）");
    ok(cr >= 3, "★ " + acc + " 上的符號對比 " + cr.toFixed(2) + ":1 ≥ 3（" + why + "）");
  }
  ok(!/--splash-on-accent/.test(CFG_SRC) && !/on-accent/.test((/<style>([\s\S]*?)<\/style>/.exec(IDX) || ["", ""])[1]),
    "★ 落地設定裡沒有這個色票（多一個色票就多一種「調成看不見」的可能）");
  ok(/setVar\("--splash-on-accent", onColor\(look\.accent\)\)/.test(SPLASHJS), "★ 它是 onColor(accent) 算出來的");
}

/* ================================================================
   §73 鑰匙圈：四種情境
   ================================================================ */
section("73. 鑰匙圈讀外觀：快取優先、背景更新、下次冷啟動才生效、失敗無感");
{
  const KURL = "https://xd1104.github.io/keyring/keyring.json";
  function krBoot(mode, store) {
    return boot({
      store: ST,
      rawStore: store || {},
      beforeEval: withSplash(win => {
        const real = win.fetch;
        win.fetch = u => {
          if (String(u).indexOf(KURL) !== 0) return real(u);
          if (mode === "net") return Promise.reject(new TypeError("Failed to fetch"));
          if (mode === "bad") return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("bad json")) });
          if (mode === "nosplash") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ apps: [{ id: "movie-library" }] }) });
          if (mode === "other") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ apps: [{ id: "trade-log", splash: { name: "別人" } }] }) });
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ apps: [{ id: "movie-library", splash: { name: "好雷嗎 v2", glyph: "評", accent: "#3a7bd5" } }] })
          });
        };
      })
    });
  }
  const CK = "splash:movie-library";

  /* ① 正常：讀得到 → 寫進快取，但這一次的畫面不可以中途換字 */
  {
    const { w } = await krBoot("ok");
    ok(w.document.documentElement.style.getPropertyValue("--splash-name") === '"好雷嗎?"', "開場用的是內建預設");
    await tick(w, 1600);
    ok(w.document.documentElement.style.getPropertyValue("--splash-name") === '"好雷嗎?"',
      "★ 讀到新名字之後，這一次的畫面**沒有**中途換字（刻意的：下次冷啟動才生效）");
    const c = JSON.parse(w.localStorage.getItem(CK) || "null");
    ok(c && c.name === "好雷嗎 v2" && c.glyph === "評", "★ 但已經寫進快取了：" + JSON.stringify(c));
  }
  /* ② 有快取時，開場立刻用快取值（不等網路） */
  {
    const { w } = await boot({
      store: ST, rawStore: { [CK]: JSON.stringify({ name: "快取的名字", glyph: "快" }) },
      beforeEval: withSplash()
    });
    ok(w.document.documentElement.style.getPropertyValue("--splash-name") === '"快取的名字"',
      "★ 一開場就用快取值（絕不會為了等 keyring.json 延後開場）");
    ok(w.Splash.state().fromCache === true, "state() 也說是從快取來的");
  }
  /* ③ 有登記、但沒有 splash 欄位 ＝「我不要自訂了」→ 清掉快取 */
  {
    const { w } = await krBoot("nosplash", { [CK]: JSON.stringify({ name: "舊的" }) });
    await tick(w, 1600);
    ok(w.localStorage.getItem(CK) === null, "★ 清掉快取 ⇒ 下次冷啟動回到內建預設");
  }
  /* ④ 壞 JSON／沒網路／這個 app 沒登記 → 完全無感，保留舊快取 */
  for (const [mode, why] of [["bad", "壞掉的 JSON"], ["net", "沒網路"], ["other", "keyring 上沒登記這個 app"]]) {
    const { w, d } = await krBoot(mode, { [CK]: JSON.stringify({ name: "舊的" }) });
    await tick(w, 1600);
    const c = JSON.parse(w.localStorage.getItem(CK) || "null");
    ok(c && c.name === "舊的", "★ " + why + " → 保留舊快取（那是「沒有資訊」，不是「叫我還原」）");
    ok(d.querySelectorAll(".row[data-open]").length === 6, "　 而且 App 完全不受影響");
  }
  ok(/\.catch\(function \(\) \{/.test(SPLASHJS_C) && !/console\.(error|warn)/.test(SPLASHJS_C),
    "★ 失敗安靜吞掉，不在使用者的 console 留紅字");
  ok((SPLASHJS.match(/applyLook/g) || []).length === 2,
    "★ applyLook 只在開場前被呼叫一次（絕不會在讀到 keyring 之後再套一次＝中途換字）");
}

/* ================================================================
   §74 我們這份 splash.js 跟範本正本一模一樣
   ================================================================ */
section("74. splash.js／splash.css 是範本的複製品，不可以在這裡分岔");
{
  const h = x => crypto.createHash("sha256").update(x).digest("hex");
  /* ⚠️ 只用相對路徑。原本這裡還列了一條寫死的絕對路徑（機器綁定），
     而且找不到正本時會**靜默**退成弱斷言——換一台機器或 CI 上跑，
     「兩邊沒分岔」這件事就沒有人在驗，輸出卻仍然一片綠。
     現在退化路徑一定會在訊息開頭大聲說「這一輪沒驗到」。
     （手機的雲端 session 只看得到這一個 repo，所以刻意不做成 hard fail。） */
  const base = [R + "../app-template/motion/"].find(p => fs.existsSync(p + "splash.js"));
  if (base) {
    ok(h(SPLASHJS) === h(fs.readFileSync(base + "splash.js", "utf8")),
      "★ js/splash.js 跟正本一模一樣（onColor 兩邊不可以分岔）", base);
    ok(h(SPLASHCSS) === h(fs.readFileSync(base + "splash.css", "utf8")),
      "★ css/splash.css 也一模一樣（落地值全部寫在 index.html 的 style 裡）", base);
  } else {
    ok(/function onColor\(bg\)/.test(SPLASHJS) && /var ON_DARK  = "#1a1310";/.test(SPLASHJS),
      "⚠️ 範本正本不在旁邊（../app-template/motion/），**這一輪沒有驗到「兩邊沒分岔」**；退而求其次只確認這份是完整的模組");
    ok(/--splash-bg:#241f1b;/.test(SPLASHCSS),
      "⚠️ 同上，強檢查沒有執行：只確認 splash.css 仍是範本原樣（落地值在 index.html）");
  }
  ok(!/kr-/.test(MOTION) && !/kr-/.test(SPLASHCSS), "新的兩支 CSS 一條 kr- 規則都沒有（鑰匙圈公版自己帶樣式）");
}

process.exit(summary() ? 1 : 0);

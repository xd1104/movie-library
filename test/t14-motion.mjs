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
/* ⭐ v1.5.0 拆檔：第一幀那一小段（外觀變數、冷熱啟動、CSS 閘門、onColor）
   搬到 js/splash-boot.js，它是唯一還留在 <head> 的同步腳本。 */
const BOOTJS = read("js/splash-boot.js");
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
const BOOTJS_C = noComment(BOOTJS);
const APPJS_C = noComment(APPJS);
const NOWS = s => s.replace(/\s+/g, "");

/* 「某條規則裡某個屬性的值」（§75c／§75d 共用）。
   ⚠️ 只認**這一條**選擇器（前面是檔頭、`}` 或 `;`），不會撈到「祖先底下的同名規則」——
      那個坑 2026-08-27 在 #splash 上真的踩過（尺壞了但訊息長得像實作壞了）。 */
const ruleBody_ = (css, sel) => {
  const re = new RegExp("(?:^|[};])\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}");
  const m = re.exec(css);
  return m ? m[1] : null;
};
const declOf_ = (css, sel, prop) => {
  const b = ruleBody_(css, sel);
  if (b === null) return null;
  const m = new RegExp("(?:^|[;{])\\s*" + prop + "\\s*:([^;}]*)").exec(b);
  return m ? NOWS(m[1]) : null;
};

/* ⭐ v1.5.0：splash-boot 是 inline 在 index.html 的柵欄裡（不是 <script src>）。
   抽取器刻意**一個正則都不用**（全部 indexOf/slice）：它是「守衛的守衛」，愈笨愈好。 */
const BOOT_BEGIN = "<!-- SPLASH-BOOT-INLINE:BEGIN";
const BOOT_END = "<!-- SPLASH-BOOT-INLINE:END -->";
const TAG_OPEN = "<script>";
const TAG_CLOSE = "</" + "script>";
function inlineBootBlock(raw) {
  if (!raw) return null;
  const b = raw.indexOf(BOOT_BEGIN), e = raw.indexOf(BOOT_END);
  if (b < 0 || e < 0 || e < b) return null;
  const seg = raw.slice(b, e + BOOT_END.length);
  const s1 = seg.indexOf(TAG_OPEN), s2 = seg.indexOf(TAG_CLOSE);
  if (s1 < 0 || s2 < 0 || s2 < s1) return null;
  let body = seg.slice(s1 + TAG_OPEN.length, s2);
  if (body.charAt(0) === "\r") body = body.slice(1);
  if (body.charAt(0) === "\n") body = body.slice(1);
  return body;
}
/* 比對一律在 LF 空間做（這個 repo 是 CRLF、範本是 LF，不正規化會「紅在行尾」而不是「紅在程式分岔」） */
const toLF = x => String(x).split("\r\n").join("\n");
const sha = x => crypto.createHash("sha256").update(toLF(x)).digest("hex");

/* 從 index.html 裡把那段 inline 的 SPLASH_CONFIG 挖出來（要在 jsdom 裡真的跑它） */
const CFG_SRC = (/<script>\s*([\s\S]*?window\.SPLASH_CONFIG[\s\S]*?)<\/script>/.exec(IDX) || [])[1] || "";
/* index.html 裡**每一塊** <style>（v1.4.1 起有兩塊：關鍵路徑 CSS ＋ 開場落地值）。
   任何「inline 樣式裡有沒有 X」的斷言都要掃全部，不可以只抓第一塊。 */
const STYLE_BLOCKS = [...IDX.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);

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

/* 讓 jsdom 也跑 SPLASH_CONFIG ＋ js/splash-boot.js ＋ js/splash.js
   （harness 會把所有 <script src> 拿掉，所以平常 t1～t13 都是在「沒有 Splash」的
     狀態下跑的 ＝ 天然負控組）。
   ⚠️ 順序不可以顛倒：splash.js 靠 window.SplashBoot 才跑得起來（v1.5.0 拆檔）。 */
function withSplash(extra) {
  return function (w) {
    if (extra) extra(w);
    w.eval(CFG_SRC);
    w.eval(BOOTJS);
    w.eval(SPLASHJS);
  };
}
/* 只跑 boot、不跑 splash.js ＝ 模擬「js/splash.js 沒載到」（部署漏檔、離線）。
   §78 用它壓測交棒保險絲。 */
function withBootOnly(extra) {
  return function (w) {
    if (extra) extra(w);
    w.eval(CFG_SRC);
    w.eval(BOOTJS);
  };
}

/* ================================================================
   §60 開場「結束時」的底色：四個地方必須逐字一致
   ----------------------------------------------------------------
   ⚠️⚠️ 契約在 v1.6.0（2026-08-27）被**重新定義**過，理由一起寫在這裡，
        因為只看斷言的話會以為它被放寬了。

   舊契約：「--splash-bg 必須逐字等於 manifest.background_color，
            否則 iPhone 從主畫面開 App 會白閃一下。」
            —— 它的隱含前提是「**第一次繪製的底色 ＝ --splash-bg**」。

   新契約：**開場「沉到最後」的底色** ＝ --splash-bg ＝ manifest.background_color
            ＝ <meta theme-color> ＝ SPLASH_CONFIG.defaults.bg ＝ app.css 的 --bg。
            v1.6.0 的「白起」開場**刻意讓第一幀跟 manifest 不一樣**
            （第一幀是 #ebebeb 的白，manifest 維持 #0b0d12），
            因為它要接住的正是 iOS 把自己的啟動畫面淡出之後留下的那片白。

   為什麼這不是「為了讓測試變綠而砍掉它」：
     兩個契約要守的是同一件事 —— **畫面上不可以有一個沒人設計過的顏色跳動**。
     舊做法是「全部對齊成同一個色」；白起的做法是「把那個跳動變成一段設計過的漸變，
     而漸變的**終點**仍然對齊」。所以這一節照樣是硬界線，只是量的是終點不是第一幀。
     **第一幀由 §75／§75b 負責**，那裡才是這次真正被翻過來的地方，
     而且那裡新增了「起點**必須**跟 manifest 不一樣」的反向斷言 ——
     沒有那條的話，有人把 --sp-start 改成 #0b0d12「讓顏色統一」就會靜靜地把白起變回舊版。
   ================================================================ */
section("60. 開場**結束時**的底色四處逐字一致（第一幀不在這一節，見 §75b）");
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

  /* ⭐ 新契約的另一半：manifest **刻意沒有跟著改**。
     這條是在擋「有人看到第一幀是白的，就順手把 manifest 也改白」——
     那是另一條路（C1），代價是 Benson 必須把 App 從主畫面移除重加，他明確選了不要。
     ⚠️ 這不是美觀偏好，是**會讓他的 localStorage 看起來像被清掉**的動作。 */
  ok(MF.background_color === "#0b0d12",
    "★ manifest.background_color 仍然是深色 #0b0d12（**刻意不改**：改了 iOS 的系統啟動圖才會變，"
    + "而那要他把 App 從主畫面移除重加 —— 2026-08-27 他選了不用重加的那一版）");
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
  /* ⚠️ 掃**全部**的 <style>，不是只看第一個：v1.4.1 在 <link> 之前多了一塊
     「關鍵路徑 CSS」（見 §75），只看第一塊的話這條就會掃錯地方。 */
  const styleCss = noComment(STYLE_BLOCKS.join("\n"));   /* 註解裡也會寫到「範本」與 --splash-bg，一定要先剝掉 */
  const declared = [...new Set([...noComment(SPLASHCSS).matchAll(/(--splash-[a-z-]+)\s*:/g)].map(m => m[1]))];
  ok(declared.length >= 6, "★ splash.css 宣告了 " + declared.length + " 個 --splash-* 變數（少於 6 就是掃描壞了）");
  for (const v of declared) {
    if (v === "--splash-on-accent") {
      /* ⚠️ 這條要驗的是「它不是**設定項**」，不是「這個名字不准出現」。
         v1.4.1 起關鍵路徑那塊會用 var(--splash-on-accent) **引用**它（值仍然只有 onColor 算得出來），
         所以判準精確化成「不可以有宣告」——`--splash-on-accent:` 或 `--splash-on-accent :`。
         （引用不會讓它變成可調的旋鈕；宣告才會。） */
      ok(!new RegExp(v + "\\s*:").test(styleCss),
        "★ " + v + " 刻意不在落地設定裡（沒有任何一塊 <style> 宣告它，值由 onColor 算）");
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
  const iBoot = IDX.indexOf(BOOT_BEGIN);          /* v1.5.0：boot 是 inline 在柵欄裡，不是 <script src> */
  const iJs = IDX.indexOf('src="./js/splash.js"');
  const iHead = IDX.indexOf("</head>");
  const iAppJs = IDX.indexOf('src="./js/app.js"');
  ok(iApp >= 0 && iMo >= 0 && iSp >= 0 && iCfg >= 0 && iBoot >= 0 && iJs >= 0, "六個東西都在（尺沒壞）");
  ok(iApp < iMo, "★ app.css 在 motion.css 之前（同權重時後宣告者勝，動效才蓋得過既有規則）");
  ok(iMo < iSp, "★ motion.css 在 splash.css 之前（splash 要吃 --dur-* token）");
  ok(iCfg < iBoot, "★ SPLASH_CONFIG 在 inline 的 splash-boot 之前（boot 一跑就會讀它）");
  ok(iBoot < iJs, "★ splash-boot 在 splash.js 之前（splash.js 靠 window.SplashBoot 才跑得起來）");
  ok(iJs < iAppJs, "★ splash.js 在 app.js 之前（app.js 一開頭就會呼叫 Splash.hold()）");

  /* ⭐⭐ 契約變更（v1.5.0，2026-08-27，PM 授權）：
     舊契約是「splash.js 在 </head> 之前」。**新契約把那條規則轉移到 splash-boot 身上**，
     而且反過來要求 splash.js **不可以**留在 <head>。

     為什麼改：Benson 的螢幕錄影逐格拆開後，真機第一次繪製是 0.73s（點下圖示後 0.87s），
     而 iOS 大約在 0.50s 就開始把自己的啟動畫面淡出 ⇒ 中間那段露出 WKWebView 的白底。
     那是**賽跑**不是漸進優化：趕在淡出之前畫出第一幀，白色會整個消失、不是變短。
     舊結構的 <head> 裡站著三支 CSS ＋ 一支 17KB 的 splash.js，四個檔案全部是
     「畫出第一幀之前非到齊不可」。

     ⚠️ 舊契約要守的東西一個都沒有放掉，只是換了守衛的對象：
        「body 解析前就把外觀寫成 CSS 變數 ⇒ 不可能先畫預設再中途換字」
        現在由 <head> 裡 inline 的 splash-boot 負責（§62b ＋ §71 真的跑一遍驗證）。 */
  ok(iBoot < iHead, "★ inline 的 splash-boot 在 </head> 之前（body 還沒解析就把外觀設好）");
  ok(iJs > iHead, "★ splash.js **在 </head> 之後**（v1.5.0 契約：它 17KB，第一次繪製一個位元組都用不到）");

  /* ⭐ 第二版（2026-08-27 下午）：boot 從「外部 <script src>」改成「inline 在柵欄裡」，
     第一次繪製之前必須到齊的**同源請求數 2 → 1**。所以這裡要擋「有人把它改回外部檔」。 */
  ok(!/<script[^>]*src="[^"]*splash-boot\.js"[^>]*>/.test(IDX),
    "★ splash-boot **不是**外部 <script src>（改回去就等於第一次繪製之前又多一個同源請求）");

  /* ⚠️ 這裡要抓整個標籤再驗屬性，**不可以寫成「src 後面不准接 defer」**：
     `<script defer src="…">` 屬性順序一換就繞過去了。
     （2026-08-25 突變測試 X15 實抓：第一版就是這樣寫的，127 條裡唯一沒守住的就是它。） */
  const spTag = (/<script[^>]*src="\.\/js\/splash\.js"[^>]*>/.exec(IDX) || [""])[0];
  ok(!!spTag, "撈得到 splash.js 那個 script 標籤（尺沒壞）：" + spTag);
  ok(!/\b(defer|async|type="module")\b/.test(spTag),
    "★ splash.js 是同步 script：同步一定跑在 defer 之前，才保證 window.Splash 早於 app.js", spTag);
  ok(/<div id="splash" aria-hidden="true">/.test(IDX), "body 最前面有 #splash（而且 aria-hidden）");
  ok(/<div class="sp-glyph"><\/div>/.test(IDX) && /<div class="sp-name"><\/div>/.test(IDX),
    "★ 符號與名字的元素刻意是空的（文字由 CSS content 畫，才不會先畫預設再換）");
}

/* ================================================================
   §62b 第一次繪製前只准一個同源請求 ＋ inline 的 splash-boot 不可以跟正本分岔
   ----------------------------------------------------------------
   ⭐ 這一節守的是 v1.5.0 的核心賭注：**第一次繪製之前必須到齊的同源請求數 ＝ 1**
      （只有 index.html）。桌機量不出差別（Service Worker 派送幾乎免費），
      但 iPhone 上每一個經過 SW 的子資源都要付一次 WKWebView 的代價。
      所以這件事**不能用時間去量，要用結構去斷言**。

   ⭐ 分岔判準：**LF 正規化之後逐位元組相同**（連註解都要一樣）。
      PM 原本建議「剝掉註解＋壓縮空白再比」，我刻意沒有那樣做——
      splash-boot.js 裡有 "https://xd1104.github.io/…" 這種**字串裡的 //**，
      天真的註解剝除器會把它當行註解、把後面整段吃掉；剝除器只要在**寬鬆的方向**出錯，
      守衛就會在「程式其實已經分岔」時放行 ＝ 尺壞了但一片綠。
      而不剝的代價是 index.html 多約 14KB —— 那 14KB 本來就要傳（原本是 splash-boot.js
      那個獨立請求），只是換條路走，而且它在 SW 殼快取裡。
      ⇒ 逐位元組是**更嚴格**的守衛，成本卻是零。
   ================================================================ */
section("62b. 第一次繪製只靠 index.html 一個請求；inline 的 boot 不可以跟正本分岔");
{
  const inlineBoot = inlineBootBlock(IDX);
  ok(inlineBoot !== null, "★ 撈得到柵欄裡的 boot 副本（撈不到＝這一整節等於沒跑）");

  /* ① 分岔：index.html 的副本 vs 本 repo 的 js/splash-boot.js（§74 再把它釘在範本正本上） */
  ok(inlineBoot !== null && sha(inlineBoot) === sha(BOOTJS),
    "★ inline 的 splash-boot 跟 js/splash-boot.js **逐位元組相同**（LF 正規化後 SHA-256）"
    + (inlineBoot === null ? "" : "：" + sha(BOOTJS).slice(0, 12) + "…"));
  /* 負控組：證明這條比對不是恆真 */
  ok(sha("a") !== sha("b"), "負控：不同內容的 SHA 必須不同");
  ok(sha("a\r\nb") === sha("a\nb"), "負控：CRLF 與 LF 必須被正規化成一樣（否則會紅在行尾而不是紅在程式）");
  ok(inlineBoot === null || sha(inlineBoot + " ") !== sha(BOOTJS),
    "負控：多一個空白就必須算分岔（判準真的是逐位元組）");
  ok(inlineBootBlock("<html>沒有柵欄</html>") === null, "負控：沒有柵欄時抽取器要回 null，不可以回空字串");

  /* ② onColor 的真相來源只有一份：index.html 裡出現的每一份，都必須就是柵欄裡那一份 */
  const nAll = IDX.split("function onColor").length - 1;
  const nIn = inlineBoot === null ? -1 : inlineBoot.split("function onColor").length - 1;
  ok(nIn === 1, "★ 柵欄裡剛好有 1 份 function onColor（實際 " + nIn + "）");
  ok(nAll === nIn, "★ index.html 裡的 " + nAll + " 份 onColor 全部都在柵欄裡（沒有人在外面另寫一份）");
  ok(!/function\s+onColor/.test(SPLASHJS), "★ splash.js 仍然沒有自己的 onColor（走 SplashBoot.onColor）");

  /* ③ 逐字貼進 script 的兩個致命字串（貼進去 HTML 解析器會提早關掉 script，
        程式碼變成畫面上的文字，而且看起來只是「怪」、不會報錯） */
  ok(inlineBoot === null || inlineBoot.toLowerCase().indexOf("</" + "script") < 0,
    "★ 柵欄裡沒有 </script（有的話 script 會被提早關掉）");
  ok(inlineBoot === null || (inlineBoot.indexOf("<!--") < 0 && inlineBoot.indexOf("-->") < 0),
    "★ 柵欄裡沒有 <!-- 或 -->（會跟柵欄自己的註解打架）");

  /* ④ ⭐ 結構性斷言：第一次繪製之前必須到齊的同源請求 ＝ 只有 index.html
        判準有二：<head> 裡不准有任何 <script src>；每一支樣式表 <link> 都必須是非阻塞的。 */
  const head = IDX.slice(0, IDX.indexOf("</head>"));
  const headSrc = [...head.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]);
  ok(headSrc.length === 0,
    "★ <head> 裡一支 <script src> 都沒有（實際 " + headSrc.length + " 支："
    + (headSrc.join(", ") || "無") + "）—— 那是唯一還會擋住第一次繪製的東西");
  const IDX_NC2 = IDX.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));
  const liveLinks2 = [...IDX_NC2.matchAll(/<link\b[^>]*>/g)]
    .filter(m => /rel="stylesheet"/.test(m[0]))
    .filter(m => !/<noscript/.test(IDX_NC2.slice(Math.max(0, m.index - 400), m.index)) ||
                 /<\/noscript>/.test(IDX_NC2.slice(Math.max(0, m.index - 400), m.index)));
  ok(liveLinks2.length >= 3, "★ 尺沒壞：掃到 " + liveLinks2.length + " 支正式樣式表 <link>");
  const blocking = liveLinks2.filter(m => !/media="print"/.test(m[0]));
  ok(blocking.length === 0,
    "★ 沒有任何 render-blocking 的樣式表（實際 " + blocking.length + " 支阻塞）"
    + (blocking.length ? "：" + blocking.map(m => m[0].slice(0, 60)).join(" | ") : ""));
  /* 負控：這兩條判準要證明它們會回 false */
  ok(/<script[^>]*\bsrc="([^"]+)"[^>]*>/.test('<script src="./js/x.js"></script>'),
    "負控：head 掃描器抓得到一般的 <script src>");
  ok(!/media="print"/.test('<link rel="stylesheet" href="./css/app.css">'),
    "負控：一支普通的阻塞式 <link> 必須被判成阻塞");
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
  /* ⭐ 1600ms 這一刀是專門用來釘住「白起的最短顯示是 1490 不是 1230／950」的：
     1230 的話 dismiss 在 1230ms 發動、收場 OUT_MS+60=400ms，1630ms 就已經從 DOM remove 掉了
     —— 所以刀子要落在 1490 與 1630 之間。
     （v1.5.0 這一刀原本在 800ms（釘 950 vs 650）、v1.6.0 移到 1400（釘 1230 vs 950）；
       時間線一往後推，刀子不跟著移動的話這條就變成「兩個值都會過」＝ 等於沒在釘。） */
  await tick(w, 1200);
  ok(!!d.getElementById("splash"),
    "★ 1600ms 時開場仍在畫面上（白起的最短顯示 1490ms —— 名字到 1460ms 才演完，還要有一拍定格）");
  await tick(w, 900);
  ok(!d.getElementById("splash"), "★ 資料到了就收，而且是從 DOM remove 掉（不是 hidden）");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ 收掉之後片單是好的（開場沒有拖慢也沒有擋住）");
  ok(w.Splash.state().dismissed === true, "state() 也說收掉了");
  /* 直接讀模組自己回報的常數，不用時間去推——時間會被機器忙碌度影響，這條不會 */
  ok(w.Splash.state().intro === "light",
    "★ 演的是「白起」變體（state().intro，直接讀開關不用猜）：" + JSON.stringify(w.Splash.state().intro));
  ok(w.Splash.state().minShow === 1490,
    "★ 最短顯示釘死在 1490ms —— 白起的動作到 1460ms 才結束（起跑前那一拍 340 ＋ 漸深 700 ＋ 名字 420），"
    + "再留 30ms 定格。跟印記那一版的 950（動作 920 ＋ 30）是**同一條規則**，不是另外喊的數字"
    + "，實際 " + w.Splash.state().minShow);
  ok(w.Splash.state().elapsed >= 1490, "★ 最短顯示 1490ms 有守住（實際 " + w.Splash.state().elapsed + "ms）");
  /* ⭐ 這個數字不是憑空來的：它必須等於「起跑前那一拍 ＋ 漸深長度 ＋ 名字動畫長度 ＋ 一拍定格」。
     每一段都從 css/splash.css 的 --sp-lead／--sp-sink 與 motion.css 的 token 真的算一次，
     不是把 1490 抄兩遍 —— 抄兩遍的話改了 token 這條照樣綠。
     ⭐ v1.6.2 新增 --sp-lead 那一段：理由見 §75e（畫面被交到使用者眼前之前的盲窗約 273ms）。 */
  {
    const tok = n => Number((new RegExp("--dur-" + n + ":\\s*(\\d+)ms").exec(MOTION) || [])[1]);
    const d1 = tok(1), d2 = tok(2), d3 = tok(3);
    const dpress = Number((/--dur-press:\s*(\d+)ms/.exec(MOTION) || [])[1]);
    const hold = Number((/--sp-hold:\s*(\d+)ms/.exec(SPLASHCSS) || [])[1]);
    ok(d1 === 180 && d2 === 280 && d3 === 420 && dpress === 120,
      "★ 尺沒壞：從 motion.css 讀到 --dur-1/2/3/press = " + [d1, d2, d3, dpress].join("/"));
    ok(hold === 220, "★ 尺沒壞：從 splash.css 讀到 --sp-hold = " + hold + "ms");
    ok(/--sp-sink:\s*calc\(var\(--dur-3\)\s*\+\s*var\(--dur-2\)\)/.test(SPLASHCSS),
      "★ --sp-sink 是由 --dur-3 ＋ --dur-2 算出來的（沒有引進新時長）");
    ok(/--sp-lead:\s*calc\(var\(--sp-hold\)\s*\+\s*var\(--dur-press\)\)/.test(SPLASHCSS),
      "★ --sp-lead 是由 --sp-hold ＋ --dur-press 算出來的（沒有引進新時長）");
    const lead = hold + dpress;           /* 340 */
    const sink = d3 + d2;                 /* 700 */
    const nameEnd = lead + sink + d3;     /* 1460：名字 delay = lead + sink，長度 --dur-3 */
    ok(lead === 340 && sink === 700 && nameEnd === 1460,
      "★ 算出來的起跑前那一拍 " + lead + "ms、漸深 " + sink + "ms、動作結束 " + nameEnd + "ms");
    ok(w.Splash.state().minShow > nameEnd,
      "★ 最短顯示（" + w.Splash.state().minShow + "）大於動作結束的時間（" + nameEnd
      + "）—— 名字一定演得完，不會被收場切掉");
    ok(w.Splash.state().minShow - nameEnd === 30,
      "★ 而且多出來的正好是那一拍定格 30ms —— 跟印記那一版（950 − 920）逐字相同。"
      + "v1.6.2 把它從 110 縮成 30，是為了把 --sp-lead 多出來的時間吐回去一點"
      + "（改 --dur-*／--sp-lead 而忘了回頭改 MIN_SHOW 的話這條會紅）");
  }
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
  /* ⚠️ 兩支都要掃：拆檔之後「冷熱啟動判斷」住在 boot、「收場」住在 splash.js，
     只掃其中一支等於這條規則有一半沒人看（上一輪範本退件的同型缺陷）。 */
  ok(!/visibilitychange|pageshow/.test(SPLASHJS_C + "\n" + BOOTJS_C),
    "★ 沒有掛在 visibilitychange／pageshow 上重播（splash.js ＋ splash-boot.js 兩支都掃）");
  ok(/sessionStorage/.test(BOOTJS_C) && !/localStorage\.getItem\(SEEN_KEY\)/.test(BOOTJS_C),
    "★ 冷啟動判斷用 sessionStorage（localStorage 會變成一輩子只播一次）");
  ok(!/sessionStorage/.test(SPLASHJS_C), "★ 而且冷啟動判斷只有一份（splash.js 裡沒有第二套）");
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
  ok(!/animationend/.test(SPLASHJS_C + "\n" + BOOTJS_C),
    "★ 收屍不掛 animationend（沒觸發＝整個 App 打不開）—— 兩支都掃");
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
  /* ⚠️ 掃**全部** <style>（v1.4.1 起有兩塊），只看第一塊的話這條會漏。
     判準是「沒有人宣告它」——引用（var(--splash-on-accent)）是允許的，那不會讓它變成旋鈕。 */
  ok(!/--splash-on-accent/.test(CFG_SRC) && !STYLE_BLOCKS.some(b => /--splash-on-accent\s*:/.test(b)),
    "★ 沒有任何地方把這個色票宣告成落地設定（多一個可調色票就多一種「調成看不見」的可能），"
    + "掃了 SPLASH_CONFIG ＋ 全部 " + STYLE_BLOCKS.length + " 塊 <style>");
  /* ⭐ v1.5.0 的第一鐵律：onColor 的**真相來源**只准有一份。
     現在 index.html 裡確實有一份（inline 的 boot），但那是柵欄裡的逐字副本，
     §62b 用 SHA-256 釘死它不准跟 js/splash-boot.js 分岔。
     ⚠️ 所以這裡的判準不是「index.html 裡不准出現 onColor」（那已經不成立了），
        而是「出現的每一份都必須在柵欄裡」。 */
  ok(/function onColor\(bg\)/.test(BOOTJS) && !/function onColor/.test(SPLASHJS),
    "★ onColor() 的定義只在 splash-boot（splash.js 走 SplashBoot.onColor）");
  ok(/function relLum\(hex\)/.test(BOOTJS) && !/function relLum/.test(SPLASHJS),
    "★ relLum() 同理，只有一份");
  {
    const ib = inlineBootBlock(IDX);
    const nAll = IDX.split("function onColor").length - 1;
    const nIn = ib === null ? -1 : ib.split("function onColor").length - 1;
    ok(nAll === 1 && nIn === 1,
      "★ index.html 裡的 onColor 剛好 1 份、而且就在柵欄裡（全部 " + nAll + " 份／柵欄內 " + nIn + " 份）");
  }
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
  /* 讀鑰匙圈是在開場收掉之後才發動的：MIN_SHOW → 收場 OUT_MS+60=400 → afterSplash 再等 400。
     v1.6.0 白起把 MIN_SHOW 從 950 拉到 1230 ⇒ 1230+400+400 = 2030ms 才會有結果 ⇒ 當時拉到 2400。
     v1.6.2 再把 MIN_SHOW 拉到 1490（多了 --sp-lead 那一拍，見 §75e）
     ⇒ 1490+400+400 = **2290ms**，2400 只剩 110ms 餘裕 ⇒ 拉到 2700。
     ⚠️ 這個數字跟著 splash.js 的 MIN_SHOW 走 —— 改 MIN_SHOW 要回來看這一行。
     ⚠️ 而且它是「等夠久」不是「等剛好」：太短會變成偽陰性（看起來像鑰匙圈壞了）。 */
  const KR_WAIT = 2700;

  /* ① 正常：讀得到 → 寫進快取，但這一次的畫面不可以中途換字 */
  {
    const { w } = await krBoot("ok");
    ok(w.document.documentElement.style.getPropertyValue("--splash-name") === '"好雷嗎?"', "開場用的是內建預設");
    await tick(w, KR_WAIT);
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
    await tick(w, KR_WAIT);
    ok(w.localStorage.getItem(CK) === null, "★ 清掉快取 ⇒ 下次冷啟動回到內建預設");
  }
  /* ④ 壞 JSON／沒網路／這個 app 沒登記 → 完全無感，保留舊快取 */
  for (const [mode, why] of [["bad", "壞掉的 JSON"], ["net", "沒網路"], ["other", "keyring 上沒登記這個 app"]]) {
    const { w, d } = await krBoot(mode, { [CK]: JSON.stringify({ name: "舊的" }) });
    await tick(w, KR_WAIT);
    const c = JSON.parse(w.localStorage.getItem(CK) || "null");
    ok(c && c.name === "舊的", "★ " + why + " → 保留舊快取（那是「沒有資訊」，不是「叫我還原」）");
    ok(d.querySelectorAll(".row[data-open]").length === 6, "　 而且 App 完全不受影響");
  }
  ok(/\.catch\(function \(\) \{/.test(SPLASHJS_C) && !/console\.(error|warn)/.test(SPLASHJS_C),
    "★ 失敗安靜吞掉，不在使用者的 console 留紅字");
  /* applyLook 現在住在 boot：一次定義、一次呼叫，就這樣。
     ⚠️ 判準用 `applyLook(` 不是 `applyLook` —— 匯出用的 `applyLook: applyLook` 不算呼叫。 */
  ok((BOOTJS.match(/applyLook\(/g) || []).length === 2,
    "★ applyLook 只在開場前被呼叫一次（絕不會在讀到 keyring 之後再套一次＝中途換字）");
  ok(!/applyLook/.test(SPLASHJS),
    "★ splash.js 完全不碰 applyLook（讀到鑰匙圈只寫快取，下次冷啟動才生效）");
}

/* ================================================================
   §74 我們這份 splash.js 跟範本正本一模一樣
   ================================================================ */
section("74. splash.js／splash.css 是範本的複製品，不可以在這裡分岔");
{
  /* ⚠️ 比對前一定要把換行正規化成 LF。
     這個 repo 是 CRLF（Windows 的 core.autocrlf），app-template 用 .gitattributes 強制 LF，
     所以 git 只要重新簽出一次（rebase、切分支、重 clone），同一份檔案的位元組就會不一樣，
     這條會紅在「行尾」而不是「程式分岔」——2026-08-26 rebase 之後就真的紅了一次。
     它要守的是「程式沒有分岔」，不是「行尾一樣」。
     （同一個根因也讓 test/mutate.mjs 的 50 條突變靜默失效過，見那支檔案的註解。） */
  const h = x => crypto.createHash("sha256").update(String(x).replace(/\r\n/g, "\n")).digest("hex");
  /* ⚠️ 只用相對路徑。原本這裡還列了一條寫死的絕對路徑（機器綁定），
     而且找不到正本時會**靜默**退成弱斷言——換一台機器或 CI 上跑，
     「兩邊沒分岔」這件事就沒有人在驗，輸出卻仍然一片綠。
     現在退化路徑一定會在訊息開頭大聲說「這一輪沒驗到」。
     （手機的雲端 session 只看得到這一個 repo，所以刻意不做成 hard fail。） */
  const base = [R + "../app-template/motion/"].find(p => fs.existsSync(p + "splash.js"));
  if (base) {
    /* ⭐ v1.5.0 起是**三個檔**要比對（splash-boot.js 是拆出來的那一支，
       onColor 的唯一正本就住在它裡面 —— 它分岔的後果比 splash.js 更嚴重）。 */
    ok(h(BOOTJS) === h(fs.readFileSync(base + "splash-boot.js", "utf8")),
      "★ js/splash-boot.js 跟正本一模一樣（onColor 的唯一正本，兩邊不可以分岔）", base);
    ok(h(SPLASHJS) === h(fs.readFileSync(base + "splash.js", "utf8")),
      "★ js/splash.js 跟正本一模一樣", base);
    ok(h(SPLASHCSS) === h(fs.readFileSync(base + "splash.css", "utf8")),
      "★ css/splash.css 也一模一樣（落地值全部寫在 index.html 的 style 裡）", base);
  } else {
    ok(/function onColor\(bg\)/.test(BOOTJS) && /var ON_DARK  = "#1a1310";/.test(BOOTJS),
      "⚠️ 範本正本不在旁邊（../app-template/motion/），**這一輪沒有驗到「兩邊沒分岔」**；退而求其次只確認 splash-boot.js 是完整的模組");
    ok(/window\.SplashBoot/.test(SPLASHJS),
      "⚠️ 同上，強檢查沒有執行：只確認 splash.js 是拆檔後的那一份（吃 window.SplashBoot）");
    ok(/--splash-bg:#241f1b;/.test(SPLASHCSS),
      "⚠️ 同上，強檢查沒有執行：只確認 splash.css 仍是範本原樣（落地值在 index.html）");
  }
  ok(!/kr-/.test(MOTION) && !/kr-/.test(SPLASHCSS), "新的兩支 CSS 一條 kr- 規則都沒有（鑰匙圈公版自己帶樣式）");
}

/* ================================================================
   §75 第一次繪製必定是深色（v1.4.1 白閃修正）
   ------------------------------------------------------------
   Benson 2026-08-26 回報：真 iPhone 從主畫面開 PWA「先閃一下白色，才開始播開場」。
   iOS 的順序是：系統開場（manifest.background_color ＋ icon）→ 建 WKWebView
   → **第一次繪製之前 WebView 是白的** → 頁面第一次繪製。
   我們控制得了的只有兩件事：①第一次繪製多快 ②第一次繪製是什麼顏色。

   ②本來完全靠外部檔案：底色寫在 css/splash.css（第三支 CSS）與 css/app.css 的 body 背景。
   三支 CSS 只要有一支沒到位（離線、SW 殼快取沒建完、部署漏檔），第一次繪製就是純白。
   2026-08-26 用本機真 Chrome（--headless=new ＋ CDP 逐幀取樣，量首幀像素）實測：
     三支 CSS 全部 404 時 —— 沒有 inline 關鍵 CSS 的首幀是 **#ffffff**，有的話是 **#0b0d12**。
   所以現在 index.html 的 <head> 最前面有一塊「關鍵路徑 CSS」，這一節就是在守它。
   ================================================================ */
section("75. 第一次繪製必定是深色：關鍵路徑 CSS 要 inline 在所有 <link> 之前");
{
  const links = [...IDX.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(m => m[0]);
  ok(STYLE_BLOCKS.length >= 2 && links.length >= 3,
    "★ 尺沒壞：掃到 " + STYLE_BLOCKS.length + " 塊 <style>、" + links.length + " 支外部樣式表");

  const iStyle = IDX.indexOf("<style>");
  const iLink = IDX.indexOf('<link rel="stylesheet"');
  ok(iStyle >= 0 && iLink >= 0 && iStyle < iLink,
    "★ 第一塊 <style>（關鍵路徑）排在第一支 <link rel=stylesheet> 之前");

  const CRIT = noComment(STYLE_BLOCKS[0]);

  /* ① 底色：一定要寫在 html 上（body 的背景在 overscroll 時救不了，而且 app.css 沒到就沒有） */
  const htmlBg = /html[^{]*\{[^}]*background:\s*var\(--splash-bg,\s*(#[0-9a-fA-F]{3,8})\)/.exec(CRIT);
  ok(!!htmlBg, "★ 關鍵路徑塊裡有 html 的背景色，而且走 var(--splash-bg, 後備值)");
  ok(htmlBg && htmlBg[1] === MF.background_color,
    "★ 後備色 " + (htmlBg && htmlBg[1]) + " === manifest.background_color " + MF.background_color
    + "（不一致＝白閃換成色差，一樣看得出來）");
  ok(htmlBg && htmlBg[1] === (/<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})">/.exec(IDX) || [])[1],
    "★ 後備色也 === <meta theme-color>");

  /* ② 蓋滿：外部 CSS 沒到時，#splash 仍然要是覆蓋全螢幕的那一層。
     ⚠️ 一定要抓「**裸的** #splash{...}」那一條，不可以用 /#splash\s*\{/ 直接撈第一個 ——
        v1.6.0 加了 `html[data-splash-intro="light"] #splash{...}` 之後，
        那個天真的正則會撈到白起的覆寫（它只有 background 一行）⇒ 守衛回報
        「#splash 沒有蓋滿、沒有 z-index、沒有底色」＝ 尺壞了但看起來像實作壞了。
        （同一類錯誤第三次：「先抓整體再驗屬性」——這裡是「先確定抓到的是哪一條規則」。） */
  const spRule = /(?:^|[};])\s*#splash\s*\{([\s\S]*?)\}/.exec(CRIT);
  ok(!!spRule, "★ 關鍵路徑塊裡有裸的 #splash{...} 規則（不是某個祖先選擇器底下那一條）");
  const sp = spRule ? NOWS(spRule[1]) : "";
  ok(/position:fixed/.test(sp) && /inset:0/.test(sp),
    "★ #splash 一出現就蓋滿（position:fixed ＋ inset:0）");
  ok(/z-index:200/.test(sp), "★ 疊在 app 上面（z-index:200，跟 splash.css 一致）");
  const spBgFb = /background:\s*var\(--splash-bg,\s*(#[0-9a-fA-F]{3,8})\)/.exec(spRule ? spRule[1] : "");
  ok(!!spBgFb, "★ #splash 自己也有底色（不靠繼承）");
  ok(spBgFb && spBgFb[1] === MF.background_color,
    "★ #splash 的後備底色 " + (spBgFb && spBgFb[1]) + " 也 === manifest.background_color");

  /* ③ 不可以再拉任何外部資源，否則等於沒有脫離關鍵路徑 */
  ok(!/@import/.test(CRIT) && !/url\(/.test(CRIT),
    "★ 關鍵路徑塊沒有 @import／url()（它必須完全不依賴網路）");

  /* ④ 全掃描：#splash 標記裡用到的每一個 sp-* class，關鍵路徑塊都要畫得出來。
     （不是列白名單——上一輪範本的退件全是「保證涵蓋範圍比宣稱的小」。） */
  const spClasses = [...new Set([...IDX.matchAll(/class="(sp-[a-z-]+)"/g)].map(m => m[1]))];
  ok(spClasses.length >= 5, "★ 尺沒壞：#splash 標記裡掃到 " + spClasses.length + " 個 sp-* class："
    + spClasses.join(", "));
  /* 豁免：.sp-ring 是第二拍的光環，靜態 opacity 本來就是 0；
     沒有規則時它只是一個看不見的空 div，不影響第一幀。豁免名單長度要斷言（擋偷加）。 */
  const EXEMPT = ["sp-ring"];
  ok(EXEMPT.length === 1, "★ 豁免名單只有 1 個（" + EXEMPT.join(",") + "）——要加請先想清楚為什麼");
  for (const c of spClasses) {
    if (EXEMPT.indexOf(c) >= 0) {
      ok(CRIT.indexOf("." + c + "{") < 0 && CRIT.indexOf("." + c + " {") < 0,
        "★ ." + c + " 刻意不進關鍵路徑（第一幀它是不可見的）");
      continue;
    }
    ok(new RegExp("\\." + c + "\\s*[,{:]").test(CRIT),
      "★ ." + c + " 在關鍵路徑塊裡有規則（外部 CSS 全掛也畫得出第一幀）");
  }

  /* ⑤ 符號的字色：只准引用 onColor 算出來的值，不可以在這裡寫死一個色碼
     （寫死＝同一條規則活在兩個地方，鑰匙圈換色時一定分岔，而且分岔的那一份沒有對比度下界） */
  const glyphRule = /\.sp-glyph\s*\{([\s\S]*?)\}/.exec(CRIT);
  ok(!!glyphRule, "★ 關鍵路徑塊裡有 .sp-glyph 規則");
  const gl = glyphRule ? NOWS(glyphRule[1]) : "";
  ok(/color:var\(--splash-on-accent\)/.test(gl),
    "★ 符號字色是 var(--splash-on-accent)（值由 splash.js 的 onColor 算，會跟著鑰匙圈換色）");
  ok(!/color:#[0-9a-fA-F]{3,8}/.test(gl),
    "★ 而且沒有在這裡寫死任何字色色碼");

  /* ⑥ 符號與名字的文字：外部 CSS 掛掉時也要是我們自己的品牌，不可以是空的或範本的 */
  ok(/content:var\(--splash-glyph,\s*"雷"\)/.test(CRIT), "★ 符號的後備值是「雷」");
  ok(/content:var\(--splash-name,\s*"好雷嗎\?"\)/.test(CRIT), "★ 名字的後備值是「好雷嗎?」");
  ok(!/範|#241f1b|#b2592b/.test(CRIT), "★ 關鍵路徑塊裡沒有範本的品牌");

  /* ⑦ 負控組：證明上面那些比對真的會回 false，不是恆真 */
  const FAKE = "#splash{color:red;}";
  ok(!/html[^{]*\{[^}]*background:\s*var\(--splash-bg,/.test(FAKE),
    "負控：一段沒有 html 背景的 CSS，比對結果必須是「不合格」");
  ok(!/position:fixed/.test(NOWS(FAKE)), "負控：沒有 position:fixed 的規則也必須判成不合格");
  ok(/(?:^|[};])\s*#splash\s*\{/.test("}\n#splash{background:red;}") &&
     !/(?:^|[};])\s*#splash\s*\{/.test('html[data-x="y"] #splash{background:red;}'),
    "負控：「裸的 #splash 規則」這把尺分得出 `#splash{` 與 `祖先 #splash{`（v1.6.0 就是被這個咬到的）");
}

/* ================================================================
   §75b ⭐⭐ 第一次繪製是**白色**（v1.6.0「白起」開場，2026-08-27 Benson 拍板）
   ----------------------------------------------------------------
   ⚠️⚠️ 這一節把 §75 的「第一次繪製必定是深色」**整個反過來**。
        不是放寬，是**需求變了**，理由如下（不寫清楚的話下一個人會把它「修」回去）：

   v1.5.0 賭的是「趕在 iOS 開始淡出（約 0.50s）之前畫出第一幀，白色會整個消失」。
   Benson 的螢幕錄影逐格（59.94fps）顯示我們**沒有贏**：

     0 → 0.50s     iOS 自己的啟動畫面（純黑）
     0.50 → 0.73s  **平滑淡到 #ebebeb**（iOS 把自己那張圖淡出、淡進 WKWebView）
     0.73s         硬切成 #0b0d12 的深色開場 ← **就是這個硬切讓人覺得閃了一下**

   關鍵事實是：那個白**不是「瀏覽器還沒畫」的瞬間空白**（那會是硬切），
   是一段 iOS 自己在跑的**平滑漸變**，我們畫得再快也還是排在它後面。
   ⇒ 所以這一版不再跟它搶，改成**接住它**：第一幀就是 #ebebeb，
     700ms 內平順沉成 #0b0d12，符號在過程中浮出來。
     **白不再是意外，是開場的第一拍**，畫面上沒有任何硬切點可以「閃」。

   §75 那一節要守的東西**一個字都沒有放掉**：
   「第一次繪製的顏色是**我們決定**的，不是外部 CSS 載不載得到決定的」。
   只是「我們決定的顏色」現在是白的，而且到底是哪一種由 <html data-splash-intro> 決定。
   ⇒ 所以這一節除了驗「第一幀是白的」，還要驗**反向**的那條：
     起點色**必須**跟 manifest 不一樣（不然有人把 --sp-start 改成 #0b0d12
     「讓顏色統一」就會靜靜地把白起變回舊版，而且不會有任何徵兆）。

   ⛔ 刻意不做的那條路（C1）：連 manifest.background_color 一起改白 ——
      那樣連 iOS 的系統啟動圖都是白的、全程沒有接縫，但**要 Benson 把 App 從主畫面
      移除、重新加一次**（系統啟動圖是安裝當下抄走的），而且他的 localStorage
      看起來會像被清掉。他明確選了不用重加的這一版。§60 有一條在釘 manifest 沒被改。
   ================================================================ */
section("75b. 白起：第一幀是 #ebebeb，而且**只靠 index.html 自己**（外部 CSS 全掛也成立）");
{
  const CRIT = NOWS(noComment(STYLE_BLOCKS[0]));

  /* ① 開關：必須靜態寫在 <html> 上。用 JS 加的話第一幀已經畫過了，而且不會報錯。 */
  const htmlTag = (/<html\b[^>]*>/.exec(IDX) || [""])[0];
  ok(/\bdata-splash-intro="light"/.test(htmlTag),
    "★ <html> 上有 data-splash-intro=\"light\"（唯一的開關）：" + htmlTag);
  ok(IDX.indexOf('setAttribute("data-splash-intro"') < 0 &&
     IDX.indexOf("setAttribute('data-splash-intro'") < 0,
    "★ 沒有任何地方用 JS 去設它（JS 設的時候第一幀已經畫完了＝這個變體等於沒開）");

  /* ② 起點色的單一真相來源：css/splash.css 的 --sp-start。
     關鍵路徑塊裡的後備字面值必須跟它逐字一致（不一致＝CSS 到位的前後會跳一次色）。 */
  const modStart = (/--sp-start:\s*(#[0-9a-fA-F]{3,8})/.exec(noComment(SPLASHCSS)) || [])[1];
  ok(!!modStart, "★ 尺沒壞：css/splash.css 裡讀得到 --sp-start（" + modStart + "）");
  ok(modStart === "#ebebeb",
    "★ 起點色是 #ebebeb —— **逐格量出來的 iOS 交接色**，不是 #ffffff。"
    + "寫純白會在交接點留一階看得見的亮度跳動，那正是這一版要消滅的東西");

  const litHtml = /html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)[^{}]*\{[^}]*background:var\(--sp-start,(#[0-9a-fA-F]{3,8})\)/.exec(CRIT);
  const litSp = /html\[data-splash-intro="light"\]#splash[^{}]*\{[^}]*background:var\(--sp-start,(#[0-9a-fA-F]{3,8})\)/.exec(CRIT);
  ok(!!litHtml, "★ 關鍵路徑塊裡有 <html> 的白起底色覆寫（開場播放中，第一幀就是白的）");
  ok(!!litSp, "★ 關鍵路徑塊裡也有 #splash 的白起底色覆寫（#splash 不靠繼承）");
  ok(litHtml && litHtml[1] === modStart,
    "★ html 覆寫的後備色 " + (litHtml && litHtml[1]) + " === css/splash.css 的 --sp-start " + modStart);
  ok(litSp && litSp[1] === modStart,
    "★ #splash 覆寫的後備色 " + (litSp && litSp[1]) + " 也 === --sp-start");

  /* ③ ⭐ 反向斷言：起點**必須**跟終點不一樣，否則整個變體等於沒開。
     這條就是「不要為了讓測試變綠而把契約砍掉」的那一半 —— 有它，
     「把 --sp-start 改成 #0b0d12 讓顏色統一」會立刻紅。 */
  ok(modStart.toLowerCase() !== MF.background_color.toLowerCase(),
    "★ 起點色 " + modStart + " **刻意不等於** manifest.background_color " + MF.background_color
    + "（相等＝沒有漸變＝這個變體等於沒開，而且畫面上看起來只是「開場又變回深色的」）");
  ok(contrast(modStart, MF.background_color) > 8,
    "★ 而且兩者差得夠遠（對比 " + contrast(modStart, MF.background_color).toFixed(1)
    + ":1）—— 這是一段真的看得見的漸變，不是四捨五入的色差");

  /* ④ 熱啟動與閘門那兩段**不可以**跟著變白：它們本來就不播開場，該是 App 自己的深色。
     判準是那兩條選擇器都帶著 :not([data-splash="off"])／或根本不含 data-splash-intro。 */
  ok(/html\[data-cssgate\]\{background:var\(--splash-bg,/.test(CRIT) ||
     /html\[data-cssgate\][^{,]*[,{][^}]*background:var\(--splash-bg,/.test(CRIT),
    "★ 閘門關著時（熱啟動、CSS 還沒到）底色仍然是 --splash-bg 的深色，不是白的");
  ok(litHtml && litHtml[0].indexOf(':not([data-splash="off"])') >= 0,
    "★ 白起的底色只在「還沒收場」時生效（帶 :not([data-splash=\"off\"])）"
    + " —— 收掉開場之後就交還給 app.css 的 --bg");

  /* ⑤ 漸深與時序的本體在 css/splash.css（範本的 opt-in 變體），不是在這裡另寫一份 */
  const SC = noComment(SPLASHCSS);
  /* ⚠️ 判準是 `sp-sink\s*\{` 不是 `sp-sink\b`：`\b` 在 `sp-sink-bg` 的連字號上也成立 ⇒
     把 sp-sink 整個改名，斷言會被 sp-sink-bg 餵飽而放行。
     2026-08-27 用突變實打出來的（改判準之前那條真的是綠的）。
     三條 keyframes 缺一不可：底色（html）／漸深（::before）／符號浮出。 */
  for (const kf of ["sp-sink", "sp-sink-bg", "sp-emerge"]) {
    ok(new RegExp("@keyframes\\s+" + kf + "\\s*\\{").test(SC),
      "★ css/splash.css 有 @keyframes " + kf + "（白起的三段動作缺一不可）");
  }
  ok(!/@keyframes\s+sp-sink\s*\{/.test("@keyframes sp-sink-bg{from{}}"),
    "負控：`sp-sink\\s*{` 這把尺不可以被 sp-sink-bg 餵飽（用 \\b 的話會，這就是上面那個坑）");
  ok(/html\[data-splash-intro="light"\]\s*#splash::before\s*\{/.test(SC),
    "★ 漸深走 #splash::before 的 opacity —— 不可以塞進 #splash 自己的 animation，"
    + "那條已經被收場的 sp-fade-out 佔用了（兩條時間線搶同一個屬性，收場時漸深會被重播）");
  ok(!/@keyframes\s+sp-sink\b/.test(noComment(STYLE_BLOCKS.join("\n"))),
    "★ index.html 裡**沒有**第二份 sp-sink（關鍵路徑塊只放靜止的第一幀，不放動畫："
    + "放了就是同一條規則活在兩個地方，換色時必分岔）");
  ok(/html\[data-splash-intro="light"\]\s*\.sp-ring\{\s*animation:none;\s*\}/.test(NOWS(SC).replace(/;/g, ";")) ||
     /\.sp-ring\{animation:none;\}/.test(NOWS(SC)),
    "★ 光環是用 animation:none 明確關掉的（§5 的 .sp-ring 是無條件帶動畫的，"
    + "靠「沒寫規則」關不掉，會在亮底上散出一圈沒人要的金環）");
  ok(/html\[data-splash-intro="light"\]#splash\.sp-name\{animation:sp-upvar\(--dur-3\)var\(--ease\)bothcalc\(var\(--sp-lead\)\+var\(--sp-sink\)\)/.test(NOWS(SC)),
    "★ 名字的 delay ＝ --sp-lead ＋ --sp-sink（先等過盲窗，再等底色沉完才出現：淺色字壓在亮底上讀不到）"
    + "；fill-mode 是 both 不是 backwards —— 理由見 §75c");

  /* ⑤b 減少動態：白起整個關掉、退回深色第一幀。
     ⭐ 這不是「順便處理 reduce」，是變體定義決定的：白起的價值全部在那段漸變，
        reduce 之下沒有過程可言（--dur-* 全部塌成 1ms），白就只剩「多跳一次」。
        一開始就深色反而**少一次**跳動。
     ⚠️ 兩邊都要有：css/splash.css 管「CSS 到位之後」，關鍵路徑塊管「CSS 還沒到」的那一段。
        只改一邊的話 reduce 使用者會看到「白一下下 → 深」——「同一條規則活在兩份實作裡、
        只改了一邊」正是這個專案反覆踩到的那個病。 */
  {
    const R_SC = NOWS(SC).match(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*$/);
    ok(!!R_SC && /html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)\{background:var\(--splash-bg\);animation:none;\}/.test(R_SC[0]),
      "★ css/splash.css 的 reduce 區塊把白起關掉（html 底色回 --splash-bg ＋ animation:none）");
    ok(!!R_SC && /html\[data-splash-intro="light"\]#splash::before\{animation:none;opacity:1;\}/.test(R_SC[0]),
      "★ 連 ::before 的漸深也停掉（直接就是深色那一層，不留 2ms 的白）");
    const R_CRIT = CRIT.match(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\}\}/);
    ok(!!R_CRIT, "★ 關鍵路徑塊裡**也**有 reduce 的覆寫（管的是 splash.css 還沒到的那一段）");
    ok(!!R_CRIT && /html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)/.test(R_CRIT[0]) &&
       /html\[data-splash-intro="light"\]#splash/.test(R_CRIT[0]) &&
       /background:var\(--splash-bg,#0b0d12\)/.test(R_CRIT[0]),
      "★ 而且 html 與 #splash 兩條都覆寫成 --splash-bg 的深色");
  }

  /* ⑥ 負控組：證明上面那幾把尺會回 false */
  ok(!/html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)[^{}]*\{[^}]*background:var\(--sp-start,/
      .test('html:not([data-splash="off"]){background:var(--splash-bg,#0b0d12);}'),
    "負控：只有預設那條 html 底色時，白起的判準必須判成不合格");
  ok(!/html\[data-splash-intro="light"\]#splash[^{}]*\{[^}]*background:var\(--sp-start,/
      .test('#splash{background:var(--sp-start,#ebebeb);}'),
    "負控：沒有 data-splash-intro 前綴的 #splash 規則不算白起覆寫（那會把所有情境都變白）");
  ok(contrast("#0b0d12", "#0b0d12") < 1.01, "負控：同一個顏色的對比必須是 1（證明 ③ 那把尺不是恆大於 8）");
}

/* ================================================================
   §75c ⭐⭐ 第一次繪製的那一幀 ＝ 動畫的**起始狀態**（v1.6.1，2026-08-27）
   ----------------------------------------------------------------
   Benson 說開場「有點小奇怪」。螢幕錄影逐格（59.94fps）拆出來是：

     畫格 84–88  灰白底、金色「雷」**實心**、而且下面已經看得到「好雷嗎?」
                 （淺色字壓在淺灰底上，像鬼影）
     畫格 89     「雷」**突然變半透明、名字整個消失**   ← css/splash.css 在這一格被套用
     畫格 90     同上
     畫格 91→    「雷」慢慢變回實心、名字之後才正常淡入

   ⇒ 實心 →（跳）淡掉 → 再淡回來；名字則是出現 → 消失 → 再出現。

   根因（第 34 條的「已知限制 1」自己預告過的那個窗口）：
   三支樣式表是**非阻塞**的（media="print" onload），所以順序永遠是
     第一次繪製（關鍵路徑 inline CSS 畫的）→ 幾十毫秒～數百毫秒 → splash.css 套用 → 動畫從頭跑。
   關鍵路徑塊以前畫的是**完成態**（符號實心、名字可見），而動畫的起始狀態是「還沒出現」
   ⇒ 中間必然跳一次。**深色版時代也在**（舊版名字早就是 1 → 0 → 1），
   只是深底＋深色字看不出來；白起把底色變亮，整件事就現形了。

   ⇒ 硬界線：**關鍵路徑塊對每一個「會被動畫接手」的屬性，靜態值必須等於該動畫 from 的值。**
     連帶：靜態值一旦變成起始狀態，`backwards` 就撐不住終點（演完會退回起始狀態
     ＝ 名字自己不見）⇒ 那幾條的 fill-mode 必須是 `both`／`forwards`。
     §67 的「進場一律 backwards」是為了保住 `:active`，而 #splash 全程不可互動
     （splash.css §2 有 user-select:none、裡面一顆按鈕都沒有）⇒ 那個代價在這裡是 0。

   ⚠️⚠️ 這一節**放棄了一個舊的好處**（PM 2026-08-27 拍板，不是偷偷放寬）：
     舊版關鍵路徑塊畫完成態，是為了「三支 CSS 全 404 時仍然看得到一個像樣的開場」。
     那個好處放棄了 —— **CSS 404 是罕見故障，這個跳動是每一次開 App 都會發生。**
     用「每次都醜」去換「罕見情況下比較好看」不划算。新的 CSS-404 期望值在 §75d。

   ⚠️ 為什麼不走另一條路（把 intro 動畫也 inline 進關鍵路徑塊）：
     動畫的時長全部是 css/motion.css 的 token（--dur-*／--sp-sink）。motion.css 也是非阻塞的
     ⇒ 第一次繪製時 var() 代換失敗 ⇒ 整條 animation 宣告無效 ⇒ 那一幕根本沒有動畫，
     等 motion.css 到了才從頭跑 ——**相依對象只是從 splash.css 換成 motion.css，窗口沒有消失**。
     要真的消滅它就得把時長寫死一份在 index.html，那就是「同一個數字活在兩個地方」。
   ================================================================ */
section("75c. 第一次繪製那一幀 ＝ 動畫的起始狀態（符號與名字都不可以跳）");
{
  const CRIT = noComment(STYLE_BLOCKS[0]);
  const SC = noComment(SPLASHCSS);

  /* ---- 四把小尺（都要有負控組，證明它們不是恆真／恆假）---- */
  /* 抽一條規則的內容：只認**這一條選擇器**（前面是檔頭、} 或 ;），不會撈到祖先底下的同名規則 */
  const ruleBody = (css, sel) => {
    const re = new RegExp("(?:^|[};])\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}");
    const m = re.exec(css);
    return m ? m[1] : null;
  };
  /* @keyframes 的內容（大括號要配對，裡面有巢狀的格） */
  const kfBody = (css, name) => {
    const m = new RegExp("@keyframes\\s+" + name + "\\s*\\{").exec(css);
    if (!m) return null;
    let i = m.index + m[0].length, depth = 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (!depth) break; }
    }
    return depth ? null : css.slice(m.index + m[0].length, i);
  };
  const kfStop = (kf, names) => {
    if (kf === null) return null;
    for (const n of names) {
      const m = new RegExp("(?:^|[};])\\s*" + n + "\\s*\\{([^}]*)\\}").exec(kf);
      if (m) return m[1];
    }
    return null;
  };
  const declOf = (body, prop) => {
    if (body === null) return null;
    const m = new RegExp("(?:^|[;{])\\s*" + prop + "\\s*:([^;}]*)").exec(String(body));
    return m ? NOWS(m[1]) : null;
  };
  /* 關鍵路徑塊的「有效靜態值」：只在指定的那幾條選擇器之間做迷你 cascade（高特異性排前面） */
  const critEff = (css, sels, prop, initial) => {
    for (const s of sels) {
      const v = declOf(ruleBody(css, s), prop);
      if (v !== null) return v;
    }
    return initial;
  };
  /* scale(1)／translateY(0) 跟 none 是同一個矩陣，1.0 跟 1 是同一個數 —— 不正規化的話
     這把尺會對著「畫面完全一樣」報錯，那是尺壞了。只認恆等寫法，不要擴充成模糊比對。 */
  const same = (prop, a, b) => {
    if (a === null || b === null) return a === b;
    if (prop === "opacity") return Number(a) === Number(b);
    const n = v => {
      const s = NOWS(v).toLowerCase();
      return ["scale(1)", "scale(1,1)", "scalex(1)", "translatey(0)", "translatey(0px)",
        "translate(0,0)", "translate(0px,0px)"].includes(s) ? "none" : s;
    };
    return n(a) === n(b);
  };

  ok(kfBody(SC, "sp-up") !== null && kfBody(SC, "sp-emerge") !== null,
    "★ 尺沒壞：抓得到 @keyframes sp-up 與 sp-emerge");
  ok(kfBody("@keyframes sp-sink-bg{from{opacity:0;}}", "sp-sink") === null,
    "負控：kfBody 不可以被 sp-sink-bg 餵飽（`\\b` 在連字號上也成立，這是踩過的坑）");
  ok(declOf("opacity:0;transform:none;", "opacity") === "0" &&
     declOf("font-size:20px;", "opacity") === null &&
     declOf("-webkit-opacity:9;", "opacity") === null,
    "負控：declOf 讀得到值、沒宣告時回 null、不會被帶前綴的屬性名餵飽");
  ok(same("transform", "scale(1)", "none") && !same("transform", "scale(.985)", "none") &&
     same("opacity", "1.0", "1") && !same("opacity", "0", "1"),
    "負控：值的等價比對認得單位矩陣，但分得出真的縮放與真的透明度");

  /* ---- 對照表：白起變體下，每一個被動畫接手的元素 ---- */
  const TARGETS = [
    { what: "符號", anim: "sp-emerge",
      modSel: 'html[data-splash-intro="light"] #splash .sp-glyph',
      critSels: ['html[data-splash-intro="light"] .sp-glyph', ".sp-glyph"] },
    { what: "名字", anim: "sp-up",
      modSel: 'html[data-splash-intro="light"] #splash .sp-name',
      critSels: ['html[data-splash-intro="light"] .sp-name', ".sp-name"] }
  ];
  ok(TARGETS.length === 2, "★ 尺沒壞：白起有 2 個會被動畫接手的元素（符號、名字）");

  /* 抽成函式才能拿假輸入回頭驗它不是恆綠（見最後的負控組） */
  const mismatches = (critCss) => {
    const out = [];
    for (const t of TARGETS) {
      const rule = ruleBody(SC, t.modSel);
      if (rule === null) { out.push("找不到 " + t.modSel); continue; }
      const anim = (/animation\s*:\s*([^;]+)/.exec(rule) || [, ""])[1];
      if (anim.indexOf(t.anim) < 0) { out.push(t.what + " 的動畫不是 " + t.anim); continue; }
      const kf = kfBody(SC, t.anim);
      const from = kfStop(kf, ["from", "0%"]);
      const to = kfStop(kf, ["to", "100%"]);
      if (from === null) { out.push("@keyframes " + t.anim + " 沒有 from"); continue; }
      for (const prop of ["opacity", "transform"]) {
        const start = declOf(from, prop);
        if (start === null) continue;               /* 這一拍沒動這個屬性 ⇒ 沒有約束 */
        const got = critEff(critCss, t.critSels, prop, prop === "opacity" ? "1" : "none");
        if (!same(prop, got, start)) {
          out.push(t.what + "的 " + prop + "：第一幀是 " + got + "，動畫 from 是 " + start);
        }
        const end = declOf(to, prop);
        if (end !== null && !same(prop, end, got) && !/\b(both|forwards)\b/.test(anim)) {
          out.push(t.what + "的 " + prop + " fill-mode 撐不住終點（演完會退回 " + got + "）");
        }
      }
    }
    return out;
  };

  const bad = mismatches(CRIT);
  ok(bad.length === 0,
    "★★ 第一幀與動畫起始狀態逐條相同（符號與名字的 opacity／transform，含 fill-mode 撐得住終點）",
    bad.join(" ｜ "));

  /* 逐條把實際值印出來，不要只給「過了」 */
  for (const t of TARGETS) {
    const from = kfStop(kfBody(SC, t.anim), ["from", "0%"]);
    const gotO = critEff(CRIT, t.critSels, "opacity", "1");
    ok(same("opacity", gotO, declOf(from, "opacity")),
      "★ " + t.what + "：關鍵路徑 opacity=" + gotO + " ＝ @keyframes " + t.anim
      + " from 的 opacity=" + declOf(from, "opacity"));
  }

  /* ---- 負控組：拿「v1.6.0 那一版的關鍵路徑塊」（完成態）餵同一把尺，必須抓得到 ----
     這是本輪的核心：證明這條斷言真的抓得到 Benson 看到的那個跳動。 */
  {
    const OLD = ".sp-name{font-size:20px; font-weight:700;}\n.sp-glyph{width:76px; height:76px;}";
    const caught = mismatches(OLD);
    ok(caught.length >= 2,
      "負控：拿 v1.6.0 的完成態關鍵路徑塊來驗，必須抓到符號與名字兩邊都會跳（抓到 "
      + caught.length + " 條：" + caught.join(" ｜ ") + "）");
    ok(caught.some(s => s.indexOf("名字") === 0) && caught.some(s => s.indexOf("符號") === 0),
      "負控：而且兩個元素都要被點名，不是只抓到其中一個");
  }

  /* ---- #splash::before（白起的漸深層）刻意不進關鍵路徑 ----
     關鍵路徑塊沒有這條規則 ⇒ 那個盒子根本不存在 ＝ 畫不出東西，
     跟模組裡的靜態 opacity:0 等價。兩邊有任何一邊變了都要紅。 */
  ok(!/#splash::before/.test(NOWS(CRIT)),
    "★ 關鍵路徑塊沒有 #splash::before（漸深那一層放進來就是同一條動畫活在兩個地方）");
  ok(declOf(ruleBody(SC, 'html[data-splash-intro="light"] #splash::before'), "opacity") === "0",
    "★ 而模組裡 ::before 的靜態 opacity 是 0 ⇒ 「沒有這個盒子」與「有但透明」畫出來一樣");

  /* ---- fill-mode：兩條進場都要 both（不是 backwards）---- */
  const N = NOWS(SC);
  ok(/#splash\.sp-name\{animation:sp-upvar\(--dur-3\)var\(--ease\)both/.test(N),
    "★ 印記變體的名字也是 both（那一版的名字本來就會 1 → 0 → 1，同一個病）");
  ok(/\.sp-glyph\{animation:sp-emergecalc\(var\(--dur-3\)\+var\(--dur-1\)\)var\(--ease\)bothvar\(--sp-lead\);\}/.test(N),
    "★ 白起的符號是 both");
  ok(!/animation:sp-up[^;]*backwards/.test(N) && !/animation:sp-emerge[^;]*backwards/.test(N),
    "★ 而且沒有任何一條 sp-up／sp-emerge 還留著 backwards（留著就是演完會自己不見）");

  /* ---- --lift／--scale-in 不可以在關鍵路徑塊寫死後備值 ----
     寫死＝同一個數字活在兩個地方；不寫的話 var() 代換失敗會退回 none，
     而那時 opacity 已經是 0（看不見），視覺上沒有差別。 */
  ok(/transform:translateY\(var\(--lift\)\)/.test(NOWS(CRIT)) &&
     !/var\(--lift,/.test(NOWS(CRIT)),
    "★ 名字的起始位移走 var(--lift)、而且**沒有**後備字面值");
  ok(/transform:scale\(var\(--scale-in\)\)/.test(NOWS(CRIT)) &&
     !/var\(--scale-in,/.test(NOWS(CRIT)),
    "★ 符號的起始縮放走 var(--scale-in)、而且**沒有**後備字面值");
}


/* ================================================================
   §75e ⭐⭐ 開場**不可以在畫面被交到使用者眼前之前就已經演掉一段**（v1.6.2，2026-08-27）
   ----------------------------------------------------------------
   ⚠️⚠️ §75c 抓不到這個病，這一節不是它的加強版，是**另一把量不同東西的尺**：
     §75c 比的是「第一幀 vs @keyframes 的 from」（**空間**上一不一樣）；
     這一節管的是「使用者第一眼看到的時候，動畫的**時間**走到哪裡了」。
     背景的 from 一直都是 --sp-start，§75c 從頭到尾都是綠的 —— 而 Benson 看到的是灰色。

   Benson 第三次回報同一個位置怪。PM 逐格（59.94fps）拆他錄的**兩次開啟**，數字幾乎一樣：

     第一次｜畫格 85 → 86 → 87   #c6c6c6 → #cdcdcd → #d4d4d4   iOS 還在平順淡向白（每格 +7）
           ｜畫格 88            **#949494**                    ← 一格之內暗掉約 64 階
           ｜畫格 89 → 92 → 100  #8f8f91 → #858487 → #5c5d61    之後又順順變深
     第二次｜畫格 318–322        #c1c1c1 → #c8c8c8 → #cfcfcf → **#949396** → #909092

   #949494 ＝「#ebebeb → #0b0d12」這條漸深走到 **39%**（三個通道各算一次都是 0.39）
   ⇒ 漸深全長 700ms ⇒ **畫面被交出來的時候，開場已經跑了約 273ms**。
   ⇒ 病根不是「第一幀畫錯」，是 **iOS 還在播它自己的啟動畫面時，我們的網頁已經在後面
     繪製並且開始跑動畫了**；等它把畫面交出來，我們的漸深已經走掉四成。

   ⚠️ 這也解釋了為什麼 iOS 的淡出從來沒有真的到達 #ebebeb（它在 #d4d4d4 就被交棒切斷）：
      殘留的那個**變亮**小台階（#d4 → #eb，約 23 階）遠比原本那個**變暗**大台階（64 階）不刺眼，
      而且它是 iOS 那一側的事，我們動不了。**不要為了消滅它去改 --sp-start。**

   修法（PM 拍板的方向 1）：在漸深開始之前先靜止住一拍 `--sp-lead`，長到蓋得住那個盲窗。
   ⛔ **不可以改用「把漸深變慢」來掩蓋** —— 放慢只是把台階變小，台階還在。
      所以這一節量的是**延遲**，不是時長：把 --sp-sink 拉長不會讓任何一條斷言變綠。

   這把尺怎麼量（三個自證）：
     ① `--sp-lead` 從 css/motion.css ＋ css/splash.css 的 token **真的算一次**，不是抄一個數字；
     ② 白起變體的動畫**全掃**（不是列白名單），逐條把 animation 簡寫裡的 delay 解析出來比對，
        並配「掃到少於 4 條就是尺壞了」的自證；
     ③ **負控組**：把 var(--sp-lead) 從那些簡寫裡拿掉（＝ v1.6.1 的寫法）再餵同一把尺，
        必須四條全抓到。

   另一把獨立的尺在 `scripts/probe/blind-window.mjs`（真 Chrome：模擬「畫面繪製後
   延遲 N 毫秒才可見」，在那一刻凍住所有動畫、截圖讀像素）。這一節是靜態的，那支是像素的。
   ================================================================ */
section("75e. 開場在「畫面真的可見」之前不可以已經推進（盲窗 273ms）");
{
  const SC = noComment(SPLASHCSS);

  /* Benson 螢幕錄影量到的盲窗。**這個數字是量出來的，不是設計參數** ——
     要改請重新錄一次影片、重新逐格算，並把新的畫格數字寫進上面那段註解。 */
  const BLIND_MS = 273;

  /* ---- 小尺 1：把 var()／calc() 解析成毫秒（token 從兩支 CSS 的 :root 真的讀） ----
     ⚠️ **先出現的贏**（不是後出現的贏）：motion.css 最後面的
     @media (prefers-reduced-motion:reduce) 會把 --dur-* 全部覆寫成 1ms，
     後者贏的話整把尺會量到「--sp-lead ＝ 2ms」然後對著正確的實作報錯 —— 那是尺壞了。
     這一節量的是**一般情況**的時間軸；reduce 之下白起整個關掉（§7f），本來就不適用。 */
  const TOK = {};
  for (const src of [MOTION, SPLASHCSS]) {
    for (const m of noComment(src).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
      if (!(m[1] in TOK)) TOK[m[1]] = m[2].trim();
    }
  }
  ok(TOK["--dur-press"] === "120ms",
    "★ 尺沒壞：--dur-press 讀到的是一般情況的 120ms，不是 reduce 覆寫的 1ms（實際 "
    + TOK["--dur-press"] + "）");
  const subst = expr => {
    let s = String(expr);
    for (let i = 0; i < 12 && /var\(/.test(s); i++) {
      s = s.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,[^()]*)?\)/gi, (all, n) => (n in TOK ? TOK[n] : all));
    }
    return s;
  };
  const ms = v => {
    const m = /^(-?\d+(?:\.\d+)?)(ms|s)$/.exec(String(v).trim());
    return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
  };
  /* calc 只支援「時間 + 時間」與「時間 - 時間」，這份 CSS 裡就只有這兩種。
     ⚠️ 不支援的寫法要回 null（＝尺壞了）而不是回 0 —— 回 0 會把「沒有延遲」說成合格。 */
  const evalMs = expr => {
    let s = subst(expr).replace(/\s+/g, " ").trim();
    for (let i = 0; i < 6 && /calc\(/.test(s); i++) {
      s = s.replace(/calc\(([^()]*)\)/i, (all, inner) => {
        const parts = inner.split(/([+-])/).map(x => x.trim()).filter(x => x !== "");
        let acc = ms(parts[0]);
        if (acc === null) return "NaNms";
        for (let k = 1; k < parts.length; k += 2) {
          const v = ms(parts[k + 1]);
          if (v === null) return "NaNms";
          acc = parts[k] === "-" ? acc - v : acc + v;
        }
        return acc + "ms";
      });
    }
    const v = ms(s);
    return v === null || Number.isNaN(v) ? null : v;
  };
  ok(evalMs("var(--dur-3)") === 420 && evalMs("var(--sp-sink)") === 700 && evalMs("220ms") === 220,
    "★ 尺沒壞：token 解析器算得出 --dur-3=420、--sp-sink=700");
  ok(evalMs("var(--ease)") === null && evalMs("linear") === null,
    "負控：不是時間的東西要回 null（回 0 的話「沒有延遲」會被說成合格）");
  ok(evalMs("calc(var(--dur-3) + var(--dur-2))") === 700 && evalMs("calc(300ms - 120ms)") === 180,
    "負控：calc 的加與減都算得對");

  /* ---- 小尺 2：從 animation 簡寫裡取出 delay（規格：第一個 <time> 是時長、第二個是延遲）----
     刻意先把整個簡寫解析成毫秒再依序取值，這樣 fill-mode／timing 擺在哪裡都不影響結果
     （「屬性順序一換就繞過去」是這個 repo 踩過兩次的坑）。 */
  const delayOf = shorthand => {
    let s = subst(shorthand);
    /* ⚠️ 一定要**跑到沒有 calc 為止**：--sp-lead 自己就是 calc，代換之後會變成
       calc(calc(220ms+120ms) + calc(420ms+280ms))，單跑一輪只會攤平最裡面那兩層，
       外層的 calc( 還在 ⇒ 340ms 與 700ms 被當成兩個獨立的時間值，delay 讀成 340 而不是 1040。 */
    for (let i = 0; i < 8 && /calc\(/.test(s); i++) {
      s = s.replace(/calc\(([^()]*)\)/gi, (all) => {
        const v = evalMs(all);
        return v === null ? all.replace(/calc\(/i, "CALCFAIL(") : v + "ms";
      });
    }
    const times = [...s.matchAll(/(-?\d+(?:\.\d+)?)(ms|s)\b/g)]
      .map(m => Number(m[1]) * (m[2] === "s" ? 1000 : 1));
    return times.length >= 2 ? times[1] : (times.length === 1 ? 0 : null);
  };
  /* ⚠️ 這幾條自證刻意用**字面值**不用 var(--sp-lead)：用真 token 的話，token 一旦被改短，
     這裡會跟著喊「尺沒壞」失敗而蓋過真正的錯誤訊息（X63 突變當場示範過）。 */
  ok(delayOf("sp-sink 700ms linear 340ms forwards") === 340,
    "★ 尺沒壞：簡寫解析器讀得到寫在 timing 後面的 delay（340ms）");
  ok(delayOf("sp-sink var(--sp-sink) linear forwards") === 0,
    "負控：沒寫 delay 就是 0（這正是 v1.6.1 的寫法，必須被判成不合格）");
  ok(delayOf("sp-up var(--dur-3) var(--ease) both calc(var(--sp-lead) + var(--sp-sink))") === 1040,
    "負控：delay 寫在 fill-mode 後面、而且是 calc 也讀得到（1040ms）");

  /* ---- ① --sp-lead 本身：由既有 token 算出來，而且蓋得住盲窗 ---- */
  ok(/--sp-lead:\s*calc\(\s*var\(--sp-hold\)\s*\+\s*var\(--dur-press\)\s*\)/.test(SC),
    "★ --sp-lead 是由 --sp-hold ＋ --dur-press 算出來的（沒有引進新時長）");
  const LEAD = evalMs(TOK["--sp-lead"]);
  ok(LEAD === 340, "★ 尺沒壞：--sp-lead 實際算出來是 " + LEAD + "ms（220 ＋ 120）");
  ok(LEAD >= BLIND_MS,
    "★★ 那一拍蓋得住盲窗：--sp-lead " + LEAD + "ms ≥ 螢幕錄影量到的 " + BLIND_MS +
    "ms（餘裕 " + (LEAD - BLIND_MS) + "ms ≒ " + ((LEAD - BLIND_MS) / 16.7).toFixed(1) + " 格）");

  /* ---- ② 白起變體的動畫全掃：每一條的 delay 都要蓋得住盲窗 ----
     全掃不是白名單：以後 §7 多加一拍（例如 tagline），這裡自動跟著驗。 */
  /* 走訪「葉節點規則」（body 裡沒有巢狀大括號的那種）。
     ⚠️ 刻意不用「(?:^|[};]) 開頭」的正則掃描：global 正則會把前一條規則的 `}` 一起吃掉，
        下一條就失去錨點而被**安靜跳過** —— 第一版真的只掃到 4 條裡的 2 條，
        而且錯誤訊息長得像實作壞了。@media 會被自動攤平、@keyframes 的 from/to
        也會被走訪到（但它們的選擇器沒有 data-splash-intro，下面會濾掉）。 */
  const leafRules = css => {
    const out = [];
    const walk = (start, end) => {
      let sel = "", i = start;
      while (i < end) {
        const c = css[i];
        if (c === "{") {
          let depth = 1, j = i + 1;
          while (j < end && depth > 0) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
          const body = css.slice(i + 1, j - 1);
          if (body.indexOf("{") < 0) out.push({ sel: sel.replace(/\s+/g, " ").trim(), body });
          else walk(i + 1, j - 1);
          sel = ""; i = j;
        } else if (c === "}") { sel = ""; i++; }
        else { sel += c; i++; }
      }
    };
    walk(0, css.length);
    return out;
  };
  ok(leafRules("a{x:1}@media(q){b{y:2}}").map(r => r.sel).join(",") === "a,b",
    "負控：走訪器攤得平 @media，而且不會把前一條的 } 吃掉害下一條被跳過");

  const lightAnims = css => {
    const out = [];
    for (const r of leafRules(css)) {
      if (r.sel.indexOf('data-splash-intro="light"') < 0) continue;
      const a = /(?:^|[;{])\s*animation\s*:\s*([^;}]+)/.exec(r.body);
      if (!a) continue;
      const val = a[1].trim();
      if (/^none$/i.test(val)) continue;          /* 明確關掉的（光環、reduce）不可能推進 */
      out.push({ sel: r.sel, val, delay: delayOf(val) });
    }
    return out;
  };
  const anims = lightAnims(SC);
  ok(anims.length >= 4,
    "★ 尺沒壞：白起變體掃到 " + anims.length + " 條會動的動畫（底色、漸深層、符號、名字）",
    anims.map(a => a.sel).join(" ｜ "));
  const early = anims.filter(a => a.delay === null || a.delay < BLIND_MS);
  ok(early.length === 0,
    "★★ 每一條開場動畫都要等過盲窗才起跑（不是只有底色那一條）",
    early.map(a => a.sel + " delay=" + a.delay).join(" ｜ "));
  for (const a of anims) {
    ok(a.delay >= BLIND_MS,
      "★ " + a.sel + "：delay " + a.delay + "ms ≥ " + BLIND_MS + "ms");
  }

  /* ---- ③ 負控組：拿掉那一拍（＝ v1.6.1 的寫法），四條都必須被抓到 ---- */
  {
    const OLD = SC
      .split(" var(--sp-lead) forwards").join(" forwards")
      .split(" both var(--sp-lead);").join(" both;")
      .split("both calc(var(--sp-lead) + var(--sp-sink))").join("both var(--sp-sink)");
    ok(OLD !== SC, "負控：改寫真的套用了（目標字串失配就會安靜地量出假綠燈）");
    const caught = lightAnims(OLD).filter(a => a.delay === null || a.delay < BLIND_MS);
    /* ⚠️ 這裡刻意是 3 不是 4：v1.6.1 的名字本來就 delay=--sp-sink=700ms，
       700 > 273 ⇒ 它從來沒有在盲窗裡偷跑過（Benson 的錄影也沒拍到名字有問題）。
       這把尺**分得出**「delay 0 的三條」與「delay 700 的那一條」，才叫量對了東西；
       要求它抓到 4 條反而是在逼尺說謊。 */
    ok(caught.length === 3,
      "負控：退回 v1.6.1 的寫法時，delay 是 0 的那三條（<html> 底色、漸深層、符號）全部被抓到（抓到 "
      + caught.length + " 條）",
      caught.map(a => a.sel + " delay=" + a.delay).join(" ｜ "));
    /* 而且要抓在正確的東西上：漸深那一層（使用者看到的顏色就是它）一定要在名單裡 */
    ok(caught.some(a => a.sel.indexOf("::before") >= 0),
      "負控：漸深那一層（#splash::before）一定要被點名 —— Benson 看到的灰色就是它");
    ok(caught.every(a => a.delay === 0),
      "負控：被抓到的都是 delay=0（不是尺把「有延遲但不夠長」跟「完全沒延遲」混在一起）");
    ok(!caught.some(a => a.sel.indexOf(".sp-name") >= 0),
      "負控：名字**不該**被抓到 —— 它 v1.6.1 就已經 delay=700ms、蓋得住盲窗，"
      + "尺要分得出這件事（抓到它才代表尺在亂咬）");
  }

  /* ---- ④ 不可以用「把漸深變慢」來掩蓋 ----
     漸深長度仍然是 --dur-3 ＋ --dur-2（沒有被偷偷拉長），台階是靠延遲消滅的不是靠拉長。 */
  ok(evalMs(TOK["--sp-sink"]) === 700,
    "★ 漸深仍然是 700ms（拉長它不會讓上面任何一條變綠，這裡再釘一次擋人走回頭路）");

  /* ---- ⑤ 那一拍只加在白起變體上，沒有波及預設（印記）---- */
  const leadUses = [...SC.matchAll(/var\(--sp-lead\)/g)].length;
  ok(leadUses === 4, "★ 尺沒壞：var(--sp-lead) 一共被用了 " + leadUses + " 次");
  ok(anims.filter(a => a.val.indexOf("--sp-lead") >= 0).length === 4,
    "★ 而且四次全部落在 data-splash-intro=\"light\" 的規則裡（預設變體一個字都沒被動到）");
  {
    const sig = leafRules(SC).filter(r => r.sel.indexOf("data-splash-intro") < 0 &&
      /(?:^|[;{])\s*animation\s*:/.test(r.body) &&
      !/^none$/i.test((/(?:^|[;{])\s*animation\s*:\s*([^;}]+)/.exec(r.body) || [, ""])[1].trim()));
    ok(sig.length >= 3,
      "★ 尺沒壞：預設（印記）變體有 " + sig.length + " 條會動的動畫（符號呼吸、光環、名字…）");
    const breathe = sig.find(r => r.body.indexOf("s-breathe") >= 0);
    ok(breathe && delayOf((/(?:^|[;{])\s*animation\s*:\s*([^;}]+)/.exec(breathe.body) || [, ""])[1]) === 400,
      "★ 印記變體的符號仍然是 --sp-hold ＋ --dur-1 ＝ 400ms 起跑（沒有被順手一起改掉）");
  }
}

/* ================================================================
   §75d ⭐ 「三支 CSS 全 404」的**新**期望值（v1.6.1 調整過，不是放寬）
   ----------------------------------------------------------------
   舊期望值：CSS 全 404 時仍然看得到一個像樣的開場（符號實心、名字可見）。
   新期望值：CSS 全 404 時只剩 **①第一幀的底色是我們決定的 #ebebeb
             ②保險絲仍然收得掉開場 ③App 仍然完整可用**。

   為什麼要換（PM 2026-08-27 拍板，理由寫在這裡免得下一個人把它「修」回去）：
     舊的好處要用「關鍵路徑塊畫完成態」換，而完成態 ≠ 動畫起始狀態
     ⇒ **每一次開 App 都會跳一次**（§75c 那個窗口）。
     CSS 404 是罕見故障（離線第一次進站、部署漏檔、SW 殼快取沒建完），
     用「每次都醜」去換「罕見情況下比較好看」不划算。

   ⚠️ 這一節刻意**不是**把舊斷言刪掉，而是換成新的期望值 ——
      「CSS 全 404」這條降級路徑仍然有測試，只是量的東西變了。
   ================================================================ */
section("75d. CSS 全 404 的新期望值：底色是我們決定的、保險絲收得掉、App 可用");
{
  const CRIT = noComment(STYLE_BLOCKS[0]);

  /* ① 第一幀的底色仍然完全由 index.html 自己決定（不依賴那三支） */
  ok(/html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)[^{}]*\{[^}]*background:var\(--sp-start,#ebebeb\)/
      .test(NOWS(CRIT)),
    "★ CSS 全 404 時 <html> 仍然是 #ebebeb（後備字面值就在關鍵路徑塊裡）");
  ok(/html\[data-splash-intro="light"\]#splash[^{}]*\{[^}]*background:var\(--sp-start,#ebebeb\)/.test(NOWS(CRIT)),
    "★ #splash 也是（不靠繼承）");

  /* ② 新期望值：名字與符號**不會**出現。這是刻意的取捨，寫成正面斷言擋人「順手修回去」 */
  ok(declOf_(CRIT, ".sp-name", "opacity") === "0",
    "★ 名字在 CSS 全 404 時是隱形的 —— 刻意的：第一幀必須等於動畫起始狀態（§75c）");
  ok(declOf_(CRIT, 'html[data-splash-intro="light"] .sp-glyph', "opacity") === "0",
    "★ 白起的符號也是。放棄的舊好處是「404 時仍有像樣的開場」，換到的是「每次開 App 都不跳」");
  /* 但符號方塊的**長相**（尺寸、圓角、底色、字色）仍然要留在關鍵路徑塊裡：
     它只是起始 opacity 是 0，不是整條規則被刪掉。 */
  ok(/\.sp-glyph\{[^}]*width:76px/.test(NOWS(CRIT)) && /\.sp-glyph\{[^}]*border-radius:22px/.test(NOWS(CRIT)),
    "★ 符號方塊的尺寸／圓角規則仍然在（只是起始透明度是 0，不是把規則刪了）");

  /* ③ 保險絲仍然收得掉、App 仍然可用 —— 真的跑一次（CSS 全 404 ＝ 三支都回報 onerror） */
  const { w, d } = await boot({ store: ST, beforeEval: withSplash() });
  const links = [...d.querySelectorAll("link[data-splash-css]")];
  ok(links.length === 3, "★ 尺沒壞：找得到 3 支樣式表（實際 " + links.length + "）");
  links.forEach(l => w.__splashCss(l));       /* 模擬三支全部 404（onerror） */
  ok(!d.documentElement.hasAttribute("data-cssgate"), "★ 閘門開了（404 不可以變成永遠看不見）");
  await tick(w, 3000);
  ok(!d.getElementById("splash"), "★ 開場被收掉了（CSS 全 404 也一樣收得掉）");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ App 完整可用（片單出得來）");
}

/* ================================================================
   §75f ⭐⭐ 開場播放中，畫面上不可以有第二個「沒在沉」的深色底（v1.6.3，2026-08-28）
   ----------------------------------------------------------------
   Benson 第四次回報，這次症狀很具體（兩次開啟、位置完全一樣：畫格 76–77 與 328–329）：
   **畫面下緣一條約 58 CSS px 的純色深色**，而**同一格的上半部仍然在正常變亮**。

     畫格 75   上半 #c9ccc9   最下緣 #c9ccc9（一致）
     畫格 76   上半 #cfd2ce   最下緣 **#0a0e11**
     畫格 77   上半 #d3d6d3   最下緣 **#0a0e11**
     畫格 78   上半 #d8dbd8   最下緣 #d8dbd8（恢復）

   `#0a0e11` 在影片壓縮誤差內就是 **#0b0d12** —— 而 `--bg`／`manifest.background_color`／
   `<meta theme-color>` **三個值剛好一模一樣**，所以錄影本身**分不出來是誰畫的**。
   附帶事實：那兩格 iOS 的 home 指示條從灰翻白 ⇒ iOS 認定那塊區域是深色的。

   ⚠️ v1.6.1 的「開場播放中不畫 App」修的是**別的東西**：那條藏的是 body 的**子元素**，
      而這條帶是**純色、沒有紋理**（App 內容是有紋理的電影卡片）⇒ 它不是 App 內容，
      `visibility:hidden` 從來就蓋不到它。所以那一版沒有把它修掉。

   兩個都說得通、而且**本機都複現不出「為什麼會露出來」**的成因：
     ① 頁面自己有一塊沒被 #splash 蓋到 ⇒ 露出 **body 自己的底色**（css/splash.css §7a2）。
        本機真 Chrome（393x852、開場中取樣）實測：
          getComputedStyle(html).backgroundColor = rgb(195,195,196)（正在沉）
          getComputedStyle(body).backgroundColor = **rgb(11,13,18)**
        把 #splash 的高度改短 59px，露出來那一條量到的就是 **#0b0d12**
        ⇒ **同一把槍確實在房間裡**（修完之後同一個實驗量到的是 #a6a7a8 ＝ 當下的漸深色）。
     ② iOS 拿 `<meta theme-color>` 去畫「頁面之外」那一圈（js/splash-boot.js §7b）。
   ⇒ **兩邊都修，不挑一個信。** manifest.background_color **不准動**
     （那是 C1，代價是他要把 App 從主畫面移除重加 —— 他明確選了不用重加的版本，§60 有反向斷言在守）。

   ⚠️⚠️ 這一節守的全部是**可機器驗的性質**（規則在不在、theme-color 有沒有跟著走、
        收場有沒有換回來）。**那條深色帶在真機上有沒有消失，只有 Benson 的螢幕錄影說得準**
        —— 這台機器沒有 safe-area、沒有 home 指示條，那個窗口複現不出來。
   ================================================================ */
section("75f. 開場播放中不可以有第二個深色底：body 讓開 ＋ theme-color 跟著走");
{
  /* ---------- ① CSS：body 讓開，而且**兩份實作都要有** ---------- */
  const SC = NOWS(noComment(SPLASHCSS));
  const CRIT_F = NOWS(noComment(STYLE_BLOCKS[0]));
  const RE_BODY = /html\[data-splash-intro="light"\]:not\(\[data-splash="off"\]\)body\{background:transparent;?\}/;

  ok(RE_BODY.test(SC),
    "★★ css/splash.css §7a2 有「開場播放中 body 底色讓開」那一條"
    + "（body 的方框畫在 html 畫布**上面**，§7a 讓 html 沉了它照樣是深的）");
  ok(RE_BODY.test(CRIT_F),
    "★★ 關鍵路徑塊**也**有同一條 —— 三支 CSS 是非阻塞的，app.css 有可能先到、splash.css 後到，"
    + "中間那個窗口 body 就是深色的，而那正是錄影拍到的那一刻");
  ok(!/:not\(\[data-splash="off"\]\)body\{[^}]*animation:/.test(SC),
    "★ body **不可以**自己再跑一條漸深（同一條時間線活在兩個地方，改 token 時必分岔）"
    + "；讓開之後畫布就只剩 §7a 那一條，任何一個瞬間都不可能對不上");
  {
    const nsBlock = (/<noscript[^>]*>([\s\S]*?)<\/noscript>/.exec(IDX) || [, ""])[1];
    ok(/body\{background:var\(--bg\)!important;?\}/.test(NOWS(nsBlock)),
      "★ <noscript> 把 body 底色釘回 --bg —— JS 停用時 <html> 上沒有 data-splash ⇒ 上面那條會匹配，"
      + "畫面會有一秒鐘是淺色的");
  }
  /* 負控組：三把尺各驗一次會不會回 false／true */
  ok(!RE_BODY.test(NOWS('html[data-splash-intro="light"]:not([data-splash="off"]){background:var(--sp-start);}')),
    "負控：只有 <html> 那一條**不算數**（那正是 v1.6.2 的狀態，而錄影拍到的就是它蓋不到的地方）");
  ok(!RE_BODY.test(NOWS("body{background:transparent;}")),
    "負控：沒有前綴的 body{background:transparent} 不算數（那會讓熱啟動與收場之後也透明）");
  ok(RE_BODY.test(NOWS('html[data-splash-intro="light"]:not([data-splash="off"]) body{background:transparent;}')),
    "負控：正確的寫法必須算數（證明這把尺不是恆 false ＝ 恆紅）");

  /* ---------- ② theme-color 跟著開場的底色走（真的跑一次 boot） ----------
     jsdom 不跑 CSS 動畫 ⇒ 把「畫面當下的底色」換成**受控的假值**，
     驗的是追蹤器的行為（讀什麼、寫什麼、什麼時候換回來），不是 CSS 的漸變曲線。 */
  const META_SEL = 'meta[name="theme-color"]';
  const themeOf = d => d.querySelector(META_SEL).getAttribute("content");
  /* 只替換 <html> 的 computed backgroundColor，其餘一律轉給 jsdom 原本的實作 */
  function withBg(box, extra) {
    return function (w) {
      const orig = w.getComputedStyle.bind(w);
      w.getComputedStyle = function (el, ps) {
        if (el === w.document.documentElement && !ps) { return { backgroundColor: box.bg }; }
        return orig(el, ps);
      };
      if (extra) extra(w);
    };
  }

  ok(/<meta name="theme-color" content="#0b0d12">/.test(IDX),
    "負控（也是契約）：index.html 裡**靜態**的 theme-color 仍然是 #0b0d12 ⇒ "
    + "下面量到的淺色一定是追蹤器寫進去的，不是原本就淺的");
  ok(/getComputedStyle\(root\)\.backgroundColor/.test(BOOTJS_C),
    "★ 追蹤器讀的是「畫面當下的 computed 底色」，不是自己再算一次漸變"
    + "（顏色的真相來源只有 css/splash.css §7a 那一條）");
  ok(!/--sp-sink|--sp-lead|--sp-start/.test(BOOTJS_C),
    "★ 所以 boot 不需要知道任何時長或起點色 —— 換 token／換變體／reduce／CSS 沒載到全部自動正確");

  /* ②a 冷啟動：第一時間就換成淺色，之後每一幀跟著走，收場逐字換回來 */
  {
    const box = { bg: "rgb(235, 235, 235)" };
    const { w, d } = await boot({ store: ST, beforeEval: withSplash(withBg(box)) });
    ok(themeOf(d) === "rgb(235, 235, 235)",
      "★★ 冷啟動：theme-color 第一時間就換成畫面當下的底色（實際 " + themeOf(d) + "）");
    ok(themeOf(d) !== "#0b0d12",
      "★★ 而且**不是** #0b0d12 —— 開場是淺的，theme-color 不可以還跟系統說「我是深色的」");
    box.bg = "rgb(120, 120, 120)";
    await tick(w, 140);
    ok(themeOf(d) === "rgb(120, 120, 120)",
      "★ 底色沉到一半，theme-color 跟著走（實際 " + themeOf(d) + "）—— 這也是狀態列文字不會看不見的理由："
      + "它拿到的永遠是畫面**當下**的真實底色，不會出現「說淺、畫面已經深」的窗口");
    box.bg = "rgb(11, 13, 18)";
    await tick(w, 140);
    ok(themeOf(d) === "rgb(11, 13, 18)", "★ 沉到終點也跟著（實際 " + themeOf(d) + "）");
    await tick(w, 3400);
    ok(!d.getElementById("splash"), "（前提）開場已經收掉了");
    ok(themeOf(d) === "#0b0d12",
      "★★ 收場之後**逐字**還原成原本的 #0b0d12（不是等價的 rgb(11, 13, 18)）"
      + " —— App 跑起來之後 theme-color 不可以是一個沒人設定過的字串");
  }
  /* ②b 底色本來就等於 theme-color（印記變體／reduce）：一個位元組都不寫 */
  {
    const box = { bg: "rgb(11, 13, 18)" };
    const { w, d } = await boot({ store: ST, beforeEval: withSplash(withBg(box)) });
    ok(themeOf(d) === "#0b0d12",
      "★ 畫面底色本來就等於 theme-color 時（印記變體、reduce）**一個位元組都不寫**："
      + "留著原本的 #0b0d12，不會被改寫成等價的 rgb(...)");
    await tick(w, 200);
    ok(themeOf(d) === "#0b0d12", "★ 跑了幾十幀也一樣 ⇒ 這一段對預設變體是隱形的");
  }
  /* ②c 熱啟動：追蹤器根本不啟動 */
  {
    const box = { bg: "rgb(235, 235, 235)" };
    const { w, d } = await boot({
      store: ST,
      beforeEval: withSplash(withBg(box, win => { win.sessionStorage.setItem("splash-seen:movie-library:1", "1"); }))
    });
    ok(d.documentElement.getAttribute("data-splash") === "off", "（前提）這是熱啟動");
    ok(themeOf(d) === "#0b0d12",
      "★ 熱啟動：theme-color 從頭到尾沒被碰過（不播開場，本來就該是 App 自己的深色）");
    await tick(w, 200);
    ok(themeOf(d) === "#0b0d12", "★ 之後也沒有（追蹤器只在冷啟動啟動）");
  }
  /* ②d 降級路徑：連 js/splash.js 都沒載到，也一定換得回來（保險絲在 boot 裡） */
  {
    const box = { bg: "rgb(235, 235, 235)" };
    const { w, d } = await boot({
      store: ST,
      beforeEval: withBootOnly(withBg(box, win => { win.Splash = { hold() { }, ready() { } }; }))
    });
    ok(themeOf(d) === "rgb(235, 235, 235)", "（前提）splash.js 沒載到，開場還在、theme-color 是淺的");
    await tick(w, 7400);
    ok(!d.getElementById("splash"), "（前提）交棒保險絲把開場收掉了");
    ok(themeOf(d) === "#0b0d12",
      "★★ 連 splash.js 都沒載到，theme-color 也一定換得回來 —— 還原的責任在 boot，"
      + "不在那支可能沒到的檔案裡（跟交棒保險絲同一個理由）");
  }
}

/* ================================================================
   §77 第一次繪製的關鍵路徑上，只准站著「第一次繪製真的需要的東西」
   ----------------------------------------------------------------
   2026-08-26 用本機真 Chrome（--headless=new ＋ CDP 逐幀取樣、
   每次取樣前把 SW／Cache Storage／localStorage／HTTP 快取全清乾淨
   ＝ Benson 用 Safari 第一次開那個網址）量出來的，不是照本宣科：
     body 那六支 js 加起來 ~208KB，第一次繪製一個位元組都用不到
     （畫面完全被 #splash 蓋住，而 #splash 的長相在關鍵路徑 CSS 裡）。
     不加 defer 的話它們會用「解析器阻塞腳本」的高優先權去搶頻寬 ⇒
     Slow-3G 冷啟動 first paint 中位 2670ms → 2225ms（-420ms，三輪重現）；
     4G 冷啟動 295→277ms、走 SW 熱啟動 227→220ms（都在雜訊內，沒有退步）。
   ⚠️ 掃描式斷言：把 index.html 裡每一個本站 <script src> 全抓出來逐一驗，
      不是列白名單 —— 漏掉的那一支永遠不會有人發現。
   ================================================================ */
section("77. index.html 裡每一支本站 script 的載入形態（全掃描）");
{
  /* 字元類 [.] [/] 是刻意的（不需要跳脫字元也讀得懂）；先抓整個標籤再驗屬性，
     不可以寫成「src 後面不准接 defer」——屬性順序一換就繞過去（X15 的教訓）。 */
  const RE_SRC = new RegExp('<script[^>]*src="([.][/]js[/][^"]+)"[^>]*>', "g");
  const tags = [...IDX.matchAll(RE_SRC)].map(m => ({ tag: m[0], src: m[1], at: m.index }));
  ok(tags.length >= 7, "★ 尺沒壞：掃到 " + tags.length + " 支本站 script（少於 7 就是掃描壞了）："
    + tags.map(t => t.src).join(", "));
  const iHead = IDX.indexOf("</head>");
  /* 用屬性 token 判形態，不用字串包含 —— "deferred" 之類的檔名不會誤判 */
  const form = t => { const a = t.slice(7, -1).split(" ");
    return a.indexOf("defer") >= 0 ? "defer" : (a.indexOf("async") >= 0 ? "async" : "sync"); };
  /* 豁免只有一支（v1.5.0 第二版）：
       ./js/splash.js —— **body 尾端**的同步腳本。它不擋第一次繪製（body 都解析完了），
       但必須排在 app.js 之前：同步 script 一定跑在 defer 之前，改成 defer 就只剩
       「文件順序」在保證，多一層可以被無聲改壞的東西。
     ⚠️ splash-boot **不在這張名單上**，因為它已經不是 <script src> 了 ——
        它 inline 在 <head> 的柵欄裡（§62b 在守）。
        ⭐ 這裡刻意把它從豁免名單拿掉：留一個「指向不存在的檔案」的豁免，
           等於預先幫未來的人開了一個後門（哪天有人真的加了 ./js/splash-boot.js
           的 <script src>，這條迴圈就會安靜地放行）。豁免名單只准列真實存在的東西。
     豁免名單長度要斷言（擋人把礙事的檔案偷加進來矇混）。 */
  const EXEMPT = { "./js/splash.js": "body-sync" };
  ok(Object.keys(EXEMPT).length === 1,
    "★ 豁免名單只有 1 個（" + Object.keys(EXEMPT).join(",") + "）——要加請先想清楚為什麼");
  ok(tags.every(t => t.src !== "./js/splash-boot.js"),
    "★ splash-boot 不在 <script src> 清單裡（它 inline 在柵欄；改回外部檔就等於多一個同源請求）");
  let nDefer = 0;
  for (const t of tags) {
    if (EXEMPT[t.src] === "body-sync") {
      ok(form(t.tag) === "sync" && t.at > iHead,
        "★ " + t.src + " 是 <body> 裡的同步腳本（唯一豁免：不擋第一次繪製，但要早於 app.js）", t.tag);
      continue;
    }
    ok(t.at > iHead, "★ " + t.src + " 在 </head> 之後（head 裡不留會擋解析的腳本）");
    ok(form(t.tag) === "defer",
      "★ " + t.src + " 是 defer（第一次繪製用不到它，不可以搶關鍵路徑的頻寬）", t.tag);
    nDefer++;
  }
  ok(nDefer >= 6, "★ 真的逐一驗到 " + nDefer + " 支 defer（少於 6 代表迴圈根本沒跑進去）");
  /* defer 之間保序，所以鑰匙圈仍然排在我們自己的 js 前面（t13 另有一條在守「形態要一致」） */
  const iKr = tags.findIndex(t => t.src === "./js/keyring-unlock.js");
  const iApp = tags.findIndex(t => t.src === "./js/app.js");
  ok(iKr >= 0 && iApp >= 0 && iKr < iApp, "★ 鑰匙圈仍排在 app.js 之前（defer 會保序）");
  /* 負控組①：form() 三種形態都分得出來，不是恆回 defer */
  ok(form('<script src="./js/x.js"></script>') === "sync" &&
     form('<script async src="./js/x.js"></script>') === "async" &&
     form('<script defer src="./js/x.js"></script>') === "defer",
    "負控：form() 三種形態都分得出來（尺沒壞）");
  /* 負控組②：屬性順序換過的標籤一樣撈得到 */
  ok(new RegExp('<script[^>]*src="([.][/]js[/][^"]+)"[^>]*>').test('<script defer src="./js/app.js"></script>'),
    "負控：屬性順序換過的標籤一樣撈得到");
}

/* ================================================================
   §78 非阻塞 CSS ＋ 熱啟動 FOUC 閘門（v1.5.0 的第二、三件套）
   ----------------------------------------------------------------
   2026-08-27：Benson 錄了螢幕影片，逐格（59.94fps）拆開後量到——
     0 – 0.50s   iOS 自己的啟動畫面（純黑）
     0.50 – 0.73s **平滑淡出成接近全白**（中央像素 #ebebeb）
     0.73s        我們的第一次繪製（點下圖示後約 0.87s）
   那個白不是「瀏覽器還沒畫」的瞬間空白（那會是硬切），是 iOS 把自己的啟動畫面
   淡出、淡進 WKWebView，而我們還沒畫出任何東西。
   ⇒ **這是賽跑不是漸進優化**：趕在 iOS 開始淡出（約 0.5s）之前畫出第一幀，
     白色會整個消失，不是變短。

   三件套（缺一不可，各自單獨做都等於零收益）：
     ① splash.js 拆出 splash-boot.js（§62）
     ② 三支樣式表非阻塞（media="print" → onload 切回 all）
     ③ html[data-cssgate] 閘門，擋住熱啟動的 FOUC

   ⚠️ ② 的代價是熱啟動會露出沒套樣式的 DOM，③ 的代價是「有可能把 App 永遠藏起來」。
      所以這一節要壓測**三種失敗路徑**：CSS 遲到／CSS 404／JS 被停用。
      （上一輪這組守衛只有設計、沒有實測，PM 明確要求這次要有測試。）
   ================================================================ */
section("78a. 非阻塞 CSS 的形態（全掃描，不是列白名單）");
{
  /* ⚠️ 掃之前要先把 HTML 註解塗掉：註解裡寫著「<noscript> 那三行是給…」，
     不塗的話「哪些 link 在 noscript 裡」會整組算錯（實際踩到過，
     守衛會回報「一支樣式表都沒掃到」）。塗成等長空白，index 才不會歪。 */
  /* ⚠️ 同一個病的第二種形狀（2026-08-27 v1.6.1 踩到）：**CSS 註解**裡也會寫到
     `<noscript>`（「所以下面 <noscript> 那塊必須…」），而只塗 HTML 註解的話它還在
     ⇒ noscript 的範圍從那個字開始算 ⇒ 「掃到 0 支正式的樣式表、6 支在 noscript 裡」。
     訊息長得像實作壞了，其實是尺壞了。<style> 裡的 CSS 註解一樣要塗成等長空白。 */
  const blankIn = (s, blockRe, cmtRe) => s.replace(blockRe, blk =>
    blk.replace(cmtRe, m => m.replace(/[^\n]/g, " ")));
  const IDX_NC = blankIn(
    IDX.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " ")),
    /<style[^>]*>[\s\S]*?<\/style>/g, /\/\*[\s\S]*?\*\//g);
  ok(IDX_NC.length === IDX.length, "★ 尺沒壞：塗掉註解沒有改變長度（否則位置比較全錯）");
  ok(IDX_NC !== IDX, "★ 尺沒壞：真的塗掉了至少一段註解");
  ok(IDX_NC.indexOf("<noscript") !== IDX.indexOf("<noscript"),
    "★ 尺沒壞：塗白之後 <noscript> 的第一個出現位置往後移了（證明註解裡那些假標籤真的被塗掉）");

  const nsRanges = [...IDX_NC.matchAll(/<noscript[^>]*>[\s\S]*?<\/noscript>/g)]
    .map(m => [m.index, m.index + m[0].length]);
  ok(nsRanges.length === 1, "★ 有而且只有一組 <noscript>（掃到 " + nsRanges.length + " 組）");
  const inNs = at => nsRanges.some(([a, b]) => at >= a && at < b);

  const allLinks = [...IDX_NC.matchAll(/<link\b[^>]*>/g)]
    .filter(m => /rel="stylesheet"/.test(m[0]))
    .map(m => ({ tag: m[0], at: m.index, ns: inNs(m.index) }));
  const live = allLinks.filter(l => !l.ns);
  const nsLinks = allLinks.filter(l => l.ns);
  const hrefOf = t => (/href="([^"]+)"/.exec(t) || [, "?"])[1];

  ok(live.length === 3, "★ 尺沒壞：掃到 " + live.length + " 支正式的樣式表 <link>（應該是 3 支：app／motion／splash）");
  ok(nsLinks.length === 3, "★ <noscript> 裡也有 " + nsLinks.length + " 支 fallback");

  for (const l of live) {
    const href = hrefOf(l.tag);
    ok(/media="print"/.test(l.tag),
      "★ " + href + " 是非阻塞的（media=\"print\"）—— 第一次繪製不必等它", l.tag);
    ok(/\bdata-splash-css\b/.test(l.tag),
      "★ " + href + " 有 data-splash-css（splash-boot.js 的保險絲靠這個屬性把它們掃出來）");
    ok(/onload="this\.media='all';window\.__splashCss/.test(l.tag),
      "★ " + href + " 的 onload 會把 media 切回 all 並回報給閘門", l.tag);
    ok(/onerror="window\.__splashCss/.test(l.tag),
      "★ " + href + " 有 onerror（404 也要回報，不然要等 2 秒保險絲）", l.tag);
    ok(nsLinks.some(n => hrefOf(n.tag) === href),
      "★ " + href + " 在 <noscript> 裡有 fallback（JS 停用時 media 永遠是 print）");
  }
  /* JS 停用時也沒有人會收開場 ⇒ 全螢幕的 #splash 會永遠卡住 */
  const nsBody = nsRanges.map(([a, b]) => IDX_NC.slice(a, b)).join("\n");
  ok(/#splash\{display:none !important;\}/.test(NOWS(nsBody).replace(/!important/, " !important")) ||
     /#splash\s*\{[^}]*display:\s*none/.test(nsBody),
    "★ <noscript> 裡把 #splash 關掉（JS 停用時沒有人會收開場＝App 打不開）");
  /* 負控組：證明「是不是非阻塞」這條判準會回 false */
  ok(!/media="print"/.test('<link rel="stylesheet" href="./css/app.css">'),
    "負控：一支普通的阻塞式 <link> 必須被判成不合格");
}

section("78b. 閘門規則要寫在關鍵路徑塊裡（外部 CSS 全掛也要成立）");
{
  const CRIT = noComment(STYLE_BLOCKS[0]);
  const C = NOWS(CRIT);
  ok(/html\[data-cssgate\][^{]*\{[^}]*visibility:hidden/.test(C),
    "★ 有 html[data-cssgate] … {visibility:hidden} 的閘門規則");
  ok(C.indexOf("body>*:not(#splash)") >= 0,
    "★ 閘門是**全掃描**（body > *:not(#splash)），不是列白名單 —— 白名單一定會漏掉新加的浮動元素");
  ok(/html\[data-cssgate\]\{background:var\(--splash-bg,/.test(C) ||
     /html\[data-cssgate\][^{,]*[,{][^}]*background:var\(--splash-bg,/.test(C),
    "★ 閘門期間 <html> 的底色是 --splash-bg（深色）—— 這一段本來就是賽跑要贏的那一段，不可以自己補一塊白");
  /* ⭐⭐ v1.6.1：開場**播放中**也要把 App 內容壓住（不只閘門那一段）。
     ----------------------------------------------------------------
     Benson 的螢幕錄影在畫格 89–90（＝ splash.css 被套用的那一刻）拍到
     **畫面下緣露出一條深色的 App 內容**（看得到電影卡片）。
     時間點對得起來的原因就在上面那條閘門：閘門正好是在那一刻開的
     （三支樣式表回報完成 → boot 開閘）⇒ 任何沒被 #splash 蓋到的像素，
     會在**那一格**從「白色的 html 底」變成「深色的 App 內容」。
     ⚠️ 本機真 Chrome（390x844、逐 rAF 取樣）**量不到 #splash 沒蓋滿**
        （每一次取樣 rect 都是 0,0,390,844）⇒ 真正的成因（iOS 的 safe-area／
        fixed containing block／合成層）沒有被複現，是推論。
     ⇒ 所以修法選「開場播放中根本不畫 App」，把「#splash 有沒有蓋滿每一個
       實體像素」從正確性的前提裡拿掉 —— 整類問題結構性消失。 */
  const PLAY = /html:not\(\[data-splash="off"\]\)#splash:not\(\.out\)~\*\{visibility:hidden;?\}/;
  ok(PLAY.test(C),
    "★★ 有「開場播放中不畫 App」那一條（html:not([data-splash=off]) #splash:not(.out) ~ *）");
  ok(C.indexOf('#splash:not(.out)~*') >= 0,
    "★ 是**全掃描**（~ * 掃到 #splash 之後的每一個兄弟），不是列白名單");
  /* 三個性質各驗一次：少一個就會變成「App 永遠看不見」 */
  ok(PLAY.source.indexOf('data-splash="off"') >= 0 && PLAY.test(C),
    "★ ①帶 :not([data-splash=\"off\"]) ⇒ 熱啟動（boot 在 body 解析前就掛 off）不受影響");
  ok(PLAY.source.indexOf("\\.out") >= 0 && PLAY.test(C),
    "★ ②帶 :not(.out) ⇒ 收場淡出一開始就放行，App 才有得跟它交叉淡入");
  {
    const nsBlock = (/<noscript[^>]*>([\s\S]*?)<\/noscript>/.exec(IDX) || [, ""])[1];
    ok(/#splash~\*\{visibility:visible!important;?\}/.test(NOWS(nsBlock)),
      "★ ③<noscript> 裡把它解除 —— JS 停用時 <html> 上沒有 data-splash，"
      + "不解除的話這條會匹配，**整個 App 被藏死**");
  }
  /* 負控組 */
  const FAKE = "#splash{position:fixed;}html{background:var(--splash-bg,#000);}";
  ok(!/html\[data-cssgate\][^{]*\{[^}]*visibility:hidden/.test(NOWS(FAKE)),
    "負控：沒有閘門規則的 CSS 必須判成不合格");
  ok(!PLAY.test(NOWS('html #splash ~ *{visibility:hidden;}')),
    "負控：少了 :not([data-splash=\"off\"]) 與 :not(.out) 的版本不算數（那會把熱啟動與收場一起藏掉）");
  ok(PLAY.test(NOWS('html:not([data-splash="off"]) #splash:not(.out) ~ *{visibility:hidden;}')),
    "負控：正確寫法必須算數（證明這把尺不是恆 false ＝ 恆紅）");
  ok(!/#splash~\*\{visibility:visible!important;?\}/.test(NOWS("<style>#splash{display:none !important;}</style>")),
    "負控：只有 display:none 不算解除（display:none 擋不住兄弟選擇器）");
}

section("78b2. 開場播放中的遮罩：三條逃生路真的跑一次（不是只讀 CSS 字串）");
{
  /* ① 熱啟動：boot 在 body 解析前就掛 data-splash="off" ⇒ 遮罩從一開始就不成立 */
  {
    const { d } = await boot({
      store: ST,
      beforeEval: withSplash(win => { win.sessionStorage.setItem("splash-seen:movie-library:1", "1"); })
    });
    ok(d.documentElement.getAttribute("data-splash") === "off",
      "★ 熱啟動：data-splash=off 在第一幀就掛上 ⇒ 遮罩不匹配（App 直接看得到）");
  }
  /* ② 冷啟動走完整流程：收場時 #splash 會先拿到 .out（放行），最後整個離開 DOM */
  {
    const { w, d } = await boot({ store: ST, beforeEval: withSplash() });
    ok(!!d.getElementById("splash"), "（前提）冷啟動，開場在畫面上");
    ok(d.documentElement.getAttribute("data-splash") !== "off", "（前提）遮罩此時是成立的");
    await tick(w, 1650);
    const sp = d.getElementById("splash");
    ok(!sp || sp.classList.contains("out") ,
      "★ 最短顯示過後：#splash 帶著 .out（遮罩放行、App 與收場交叉淡入）或已經離開 DOM");
    await tick(w, 1600);
    ok(!d.getElementById("splash"), "★ 最後 #splash 從 DOM 移除 ⇒ 兄弟選擇器再也匹配不到");
    ok(d.documentElement.getAttribute("data-splash") === "off", "★ 而且 data-splash=off 也補上了（雙保險）");
  }
  /* ③ splash.js 沒載到：boot 的 7 秒交棒保險絲把 #splash 拿掉 ⇒ 遮罩自動失效 */
  {
    const { w, d } = await boot({
      store: ST,
      beforeEval: withBootOnly(win => { win.Splash = { hold() { }, ready() { } }; })
    });
    ok(!!d.getElementById("splash"), "（前提）沒有人接手，開場還在");
    await tick(w, 7400);
    ok(!d.getElementById("splash"),
      "★ 交棒保險絲把 #splash 移除 ⇒ 遮罩失效、App 看得見（遮罩不會把 App 藏死）");
  }
}

section("78c. 失敗路徑①：CSS 遲到／onload 永遠不觸發 ⇒ 2 秒保險絲一定開閘");
{
  /* jsdom 不會真的去載外部 CSS，所以這裡天然就是「onload 永遠不來」的情境 */
  const { w, d } = await boot({
    store: ST,
    beforeEval: withSplash(win => { win.sessionStorage.setItem("splash-seen:movie-library:1", "1"); })
  });
  const root = d.documentElement;
  ok(root.getAttribute("data-splash") === "off", "（前提）這是熱啟動");
  ok(root.hasAttribute("data-cssgate"), "★ boot 一進來就把閘門關上（CSS 還沒到，不可以露出裸 DOM）");
  await tick(w, 500);
  ok(root.hasAttribute("data-cssgate"), "★ 500ms 時還關著（沒有任何 link 回報過）");
  await tick(w, 1800);
  ok(!root.hasAttribute("data-cssgate"),
    "★ 2 秒保險絲一到就開閘 —— 寧可 FOUC 也不可以把 App 永遠藏起來");
  const links = [...d.querySelectorAll("link[data-splash-css]")];
  ok(links.length === 3, "★ 尺沒壞：找得到 3 支帶 data-splash-css 的 link（實際 " + links.length + "）");
  ok(links.every(l => l.media === "all"),
    "★ 而且保險絲會**強制**把 media 切回 all（onload 沒觸發時，樣式仍然要套上去）："
    + links.map(l => l.media).join("/"));
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ App 本身完全正常（片單出得來）");
  ok(/CSS_FUSE = 2000/.test(BOOTJS), "★ 保險絲時間是寫死的 2000ms（不是靠某個事件）");
}

section("78d. 失敗路徑②：CSS 404 ⇒ onerror 回報，立刻開閘不必等保險絲");
{
  const { w, d } = await boot({
    store: ST,
    beforeEval: withSplash(win => { win.sessionStorage.setItem("splash-seen:movie-library:1", "1"); })
  });
  const root = d.documentElement;
  ok(root.hasAttribute("data-cssgate"), "（前提）閘門是關著的");
  const links = [...d.querySelectorAll("link[data-splash-css]")];
  ok(typeof w.__splashCss === "function", "★ boot 有把 __splashCss() 掛在 window 上（行內屬性只看得到全域）");
  /* 模擬三支全部 404：瀏覽器會逐一觸發 onerror → 行內屬性呼叫 __splashCss(this) */
  links.forEach((l, i) => {
    w.__splashCss(l);
    if (i < links.length - 1) {
      ok(root.hasAttribute("data-cssgate"),
        "★ 只回報了 " + (i + 1) + "/3 支，閘門還不能開（開早了就是 FOUC）");
    }
  });
  ok(!root.hasAttribute("data-cssgate"), "★ 三支都回報之後立刻開閘（沒有等那 2 秒）");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ CSS 全 404，App 照樣完整可用");
  /* 這一條是「404 不可以變成永遠看不見」的核心：#splash 的關鍵路徑規則仍在 inline <style> 裡，
     所以第一次繪製仍然是深色（§75 已經逐條驗過）。 */
  ok(/color:var\(--splash-on-accent\)/.test(noComment(STYLE_BLOCKS[0])),
    "★ 而且第一幀的長相仍然完全來自 inline 的關鍵路徑 CSS（不依賴那三支）");
}

section("78e. 失敗路徑③：JS 被停用／splash-boot.js 沒載到 ⇒ 閘門根本不存在");
{
  /* harness 的預設狀態＝所有 <script src> 都被拿掉，等於「JS 停用」的效果：
     沒有人會去掛 data-cssgate ⇒ 選擇器永遠不匹配 ⇒ 畫面照常顯示。
     ⭐ 這是刻意的設計：守衛要寫成「有人負責開，才准關」。 */
  const { w, d } = await boot({ store: ST });
  await tick(w, 250);
  ok(!d.documentElement.hasAttribute("data-cssgate"),
    "★ 沒有 boot ⇒ html 上根本沒有 data-cssgate（閘門關不起來，不可能把 App 藏死）");
  ok(!w.SplashBoot, "（前提）確認 splash-boot.js 真的沒有跑");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ App 完整可用");
  /* 原始碼層：閘門只由 boot 掛上，沒有第二個地方會設它 */
  const gateSetters = (BOOTJS.match(/setAttribute\("data-cssgate"/g) || []).length;
  ok(gateSetters === 1, "★ 全專案只有 splash-boot.js 一個地方會關閘門（實際 " + gateSetters + " 處）");
  ok(!/data-cssgate/.test(SPLASHJS.replace(/removeAttribute\("data-cssgate"\)/g, "")),
    "★ splash.js 只會**開**閘門、不會關（沒有 boot 時它是收拾殘局的那一方）");
  ok(!/setAttribute\("data-cssgate"/.test(APPJS), "★ app.js 也不會去關閘門");
}

section("78f. 交棒保險絲：連 js/splash.js 都沒載到，開場也一定會消失");
{
  /* 只跑 boot、不跑 splash.js ＝ 部署漏檔／SW 殼快取沒建完。
     再假裝 app 以為模組在（window.Splash 有東西），把 app.js 的 fallback 擋掉，
     這樣就只剩 boot 自己的交棒保險絲能救 —— 那正是這一條要驗的。
     ⭐ 舊版的保險絲住在 splash.js 自己裡面（＝那支檔案沒到就沒有保險絲）。 */
  const { w, d } = await boot({
    store: ST,
    beforeEval: withBootOnly(win => { win.Splash = { hold() { }, ready() { } }; })
  });
  ok(!!w.SplashBoot, "（前提）boot 有跑");
  ok(w.__splashTakeover !== true, "（前提）沒有人接手（splash.js 沒載到）");
  ok(!!d.getElementById("splash"), "開場在畫面上，而且沒有人會來收它");
  await tick(w, 1000);
  ok(!!d.getElementById("splash"), "★ 1 秒時還在（保險絲不是提早出手）");
  await tick(w, 6400);
  ok(!d.getElementById("splash"), "★ 7 秒交棒保險絲一到就把開場從 DOM 拿掉");
  ok(d.documentElement.getAttribute("data-splash") === "off", "★ 而且 data-splash=off 也補上了");
  ok(!d.documentElement.hasAttribute("data-cssgate"), "★ 順手把閘門也開掉（不然畫面還是空的）");
  ok(/TAKEOVER_FUSE = 7000/.test(BOOTJS), "★ 保險絲時間寫死在 boot 裡（不住在那支可能沒載到的檔案）");
  ok(/W\.__splashTakeover/.test(BOOTJS) && /W\.__splashTakeover = true;/.test(SPLASHJS),
    "★ 交棒旗標兩邊對得上（splash.js 一載入就宣告接手）");
}

process.exit(summary() ? 1 : 0);

/* ============================================================
   splash.js — 開場流程（印記 sigil ＋ B 蓋住等待）＋ 從鑰匙圈讀外觀
   ------------------------------------------------------------
   ⚠️ 這支必須是 <head> 裡的「同步 script」（不要 defer、不要 async、
      不要移到 body 最後）。理由：它在 body 還沒開始解析時就把外觀
      （名字／符號／顏色）寫成 :root 上的 CSS 變數，
      所以開場第一次被畫出來時就已經是正確的樣子
      ⇒ 不可能出現「先畫預設值、再跳成新名字」。

   ⚠️ 收屍一律用 timer ＋ runId ＋ 保險絲，不掛 animationend。
      開場是全螢幕的，animationend 沒觸發＝整個 app 打不開，
      比某個面板關不掉嚴重一個等級。

   設定（在載入這支之前先寫 window.SPLASH_CONFIG）：
     {
       appId:      "trade-log",                 // 要跟 keyring.json 的 apps[].id 一樣
       version:    "1",                         // 改版後第一次進站會再播一次
       keyringUrl: "https://xd1104.github.io/keyring/keyring.json",  // 設 "" 可完全關掉
       splashSelector:"#splash", bootSelector:"#app",
       defaults: { name:"交易日誌", glyph:"T", bg:"#101820",
                   accent:"#3a7bd5", ink:"#e6edf3", tagline:"紀律比行情重要" }
     }

   對外 API（window.Splash）：
     Splash.hold()    有資料要等的 app：在最上面呼叫，宣告「我會自己說什麼時候好」
     Splash.ready()   資料回來（成功或失敗都要）呼叫，開場就會收
     Splash.dismiss() 立刻收（測試用）
     Splash.state()   目前狀態（QA 用：冷啟動與否、實際套用的外觀、已過幾毫秒）
   ============================================================ */
(function () {
  "use strict";

  var W = window;
  var D = document;
  var root = D.documentElement;

  /* iOS Safari 要有 touch 監聽，:active 才會生效
     （沒有這一行，手機上所有按下回饋都是死的） */
  try {
    D.addEventListener("touchstart", function () {}, { passive: true });
  } catch (e) {
    D.addEventListener("touchstart", function () {}, false);
  }

  /* ============================================================
     0. 設定
     ============================================================ */
  var CFG = W.SPLASH_CONFIG || {};
  var APP_ID = CFG.appId || "app";
  var APP_VER = String(CFG.version == null ? "1" : CFG.version);
  var KEYRING_URL =
    Object.prototype.hasOwnProperty.call(CFG, "keyringUrl")
      ? CFG.keyringUrl
      : "https://xd1104.github.io/keyring/keyring.json";
  var SPLASH_SEL = CFG.splashSelector || "#splash";
  var BOOT_SEL = CFG.bootSelector || "#app";
  var DEFAULTS = CFG.defaults || {};

  /* localStorage：外觀快取。key 由 PM 定死，不可以自己改。 */
  var CACHE_KEY = "splash:" + APP_ID;
  /* sessionStorage：冷啟動判斷。帶版本是為了改版後第一次進站再播一次。 */
  var SEEN_KEY = "splash-seen:" + APP_ID + ":" + APP_VER;

  var REDUCE = false;
  try {
    REDUCE = !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {}

  /* 時間常數＝產品邏輯，不是動效 token（所以在 JS 不在 CSS） */
  var MIN_SHOW = REDUCE ? 300 : 650;   /* B 模式最短顯示：避免快取秒回時「閃一下」的廉價感 */
  var FUSE = 6000;                     /* 保險絲：不管發生什麼，超過就一定收 */
  var OUT_MS = REDUCE ? 60 : 340;      /* 收場動畫長度（要對得上 --sp-out） */
  var BOOT_MS = 1400;                  /* .boot 掛多久（久了會壓到 :active） */
  var KEYRING_TIMEOUT = 8000;

  /* ============================================================
     1. 小工具
     ============================================================ */
  var nowFn =
    W.performance && typeof W.performance.now === "function"
      ? function () { return W.performance.now(); }
      : function () { return Date.now(); };
  var t0 = nowFn();
  function elapsed() { return nowFn() - t0; }

  var timers = [];
  function later(fn, ms) {
    var id = W.setTimeout(fn, Math.max(0, ms));
    timers.push(id);
    return id;
  }
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) { W.clearTimeout(timers[i]); }
    timers = [];
  }

  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

  /* ============================================================
     2. 外觀資料的清洗（鑰匙圈是外部來源，一律當成不可信）
     ------------------------------------------------------------
     每個欄位都可能不存在或是空字串 → 一律 fallback 到 app 的預設值。
     缺欄位不是錯誤，不要報錯、不要在 console 留紅字。
     ============================================================ */
  /* 契約只收 3 碼與 6 碼：開場底色帶 alpha 沒有意義（下面是空的），不該進契約。 */
  var RE_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  /* 丟掉控制字元（含換行——CSS 字串裡不能有），再去頭尾空白、截長度。
     刻意用迴圈不用正則的控制字元類別：原始碼裡不要出現真的控制字元。 */
  function txt(v, max) {
    if (v == null) return "";
    var raw = String(v);
    var s = "";
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charCodeAt(i);
      if (c < 32 || c === 127) continue;
      s += raw.charAt(i);
    }
    s = s.replace(/^\s+|\s+$/g, "");
    return s.length > max ? s.slice(0, max) : s;
  }
  function col(v) {
    var s = txt(v, 12);
    return RE_COLOR.test(s) ? s : "";
  }
  function oneChar(v) {
    var s = txt(v, 8);
    if (!s) return "";
    /* 用 Array.from 才不會把 emoji／罕用字的代理對切成半個字 */
    var arr = typeof Array.from === "function" ? Array.from(s) : s.split("");
    return arr[0] || "";
  }

  /* ⭐ 符號字色：白字與深字各算一次 WCAG 對比度，取高的那個；
     近乎平手時偏好白字（見下方 15% 規則）。
     （PM 2026-08-25 拍板：符號本身的文字色「不進契約、不讓使用者設定」。
       多一個色票就多一種「調成看不見」的可能——keyring 踩過主要按鈕
       變透明、純功能測試抓不到的雷。自動算才有下界。
       這段程式碼與鑰匙圈後台的預覽縮圖是同一份，改的話兩邊要一起改，
       否則 Benson 在後台看到的跟實機不一樣。）

     ⚠️ 不要改回「亮度 > 門檻」那種猜法——飽和的綠／青會被誤判成暗底而給白字，
        實測最差只有 2.08:1（全色域 6.8% 低於 3:1）。這裡的 gamma 校正不是裝飾。
     ⭐ 這個做法可靠的理由不是「亮度猜得準」，而是
        「取兩個候選中對比較高的那個，所以最差情況有下界」。
        含 15% 平手偏白之後，全色域「窮舉」16,777,216 色實測最差 3.95:1 @ #438c83，
        0.000% 低於 3:1。
        ⚠️ 這個數字一定要用窮舉量：抽樣（step 8）會給出假的最差色 4.28:1 @ #e04000，
           比真值樂觀 8%，而且指向錯的顏色。 */
  function relLum(hex){
    var h = String(hex||"").replace("#","");
    /* 4 碼／8 碼帶 alpha：丟掉 alpha 再算。
       契約已經收窄成只收 3 碼與 6 碼（見 RE_COLOR），這裡仍然要正確處理——
       不要因為上游收窄了就假設不會發生。
       舊版對 4/8 碼一律 return 0（當成純黑）⇒ 永遠給白字，
       #ffffffff 會變成白字白底 1.00:1，「有下界」的保證整個破功。 */
    if(h.length === 4){ h = h.slice(0,3); }
    if(h.length === 8){ h = h.slice(0,6); }
    if(h.length === 3){ h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; }
    if(!/^[0-9a-fA-F]{6}$/.test(h)){ return 0; }
    var c = [0,2,4].map(function(i){
      var v = parseInt(h.substr(i,2),16) / 255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  }
  function contrast(l1, l2){
    var hi = Math.max(l1,l2), lo = Math.min(l1,l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  var ON_LIGHT = "#ffffff";
  var ON_DARK  = "#1a1310";
  function onColor(bg){
    var L = relLum(bg);
    var w = contrast(1, L);               /* 白字 */
    var d = contrast(relLum(ON_DARK), L); /* 深字 */
    if(w >= d){ return ON_LIGHT; }
    /* 近乎平手（差距 <15%）時偏好白字：兩者都夠讀，但深字會讓符號從
       「發光的徽章」變成「挖空的洞」，跟開場其餘的淺色字分屬兩套語言。
       ⚠️ 這個 15% 是拿「最差對比」換來的，動它之前先跑全色域斷言。 */
    return (d - w) / d < 0.15 ? ON_LIGHT : ON_DARK;
  }

  /* 把任意來源（鑰匙圈的 splash 物件 / 快取 / app 預設）洗成同一個形狀。
     只留下有值的欄位，空字串一律丟掉 ⇒ 合併時自然會 fallback。 */
  function clean(o) {
    var s = o && typeof o === "object" ? o : {};
    var out = {};
    var name = txt(s.name, 24);      if (name) out.name = name;
    var glyph = oneChar(s.glyph);    if (glyph) out.glyph = glyph;
    var tag = txt(s.tagline, 48);    if (tag) out.tagline = tag;
    var bg = col(s.bg);              if (bg) out.bg = bg;
    var accent = col(s.accent);      if (accent) out.accent = accent;
    var ink = col(s.ink);            if (ink) out.ink = ink;
    return out;
  }
  function isEmpty(o) {
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) return false; }
    return true;
  }
  function merge(base, over) {
    var out = {};
    var k;
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
    for (k in over) { if (Object.prototype.hasOwnProperty.call(over, k)) out[k] = over[k]; }
    return out;
  }

  /* ============================================================
     3. 快取（localStorage）
     ------------------------------------------------------------
     隱私模式／存取被擋時全部安靜失敗——開場不可以因為存不了東西就掛掉。
     ============================================================ */
  function readCache() {
    try {
      var raw = W.localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      return clean(JSON.parse(raw));
    } catch (e) {
      return {};
    }
  }
  function writeCache(look) {
    try { W.localStorage.setItem(CACHE_KEY, JSON.stringify(look)); } catch (e) {}
  }
  function dropCache() {
    try { W.localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  /* ============================================================
     4. 套用外觀（只動 :root 上的 --splash-* 變數）
     ------------------------------------------------------------
     ⭐ 只影響開場那一幕。不碰 app 的品牌色、標題、manifest、theme-color。
     文字要包成 CSS 字串（splash.css 是用 content:var(--splash-name) 畫的）。
     ============================================================ */
  function cssStr(s) {
    return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  function setVar(name, value) {
    if (value) { root.style.setProperty(name, value); }
  }
  function applyLook(look) {
    setVar("--splash-bg", look.bg);
    setVar("--splash-ink", look.ink);
    if (look.accent) {
      setVar("--splash-accent", look.accent);
      /* 符號字色不是設定項，是算出來的（見 onColor） */
      setVar("--splash-on-accent", onColor(look.accent));
    }
    if (look.glyph) setVar("--splash-glyph", cssStr(look.glyph));
    if (look.name) setVar("--splash-name", cssStr(look.name));
    if (look.tagline) setVar("--splash-tagline", cssStr(look.tagline));
  }

  /* ============================================================
     5. 冷啟動判斷（只有冷啟動才播）
     ------------------------------------------------------------
     用 sessionStorage，不要用 localStorage：
     sessionStorage 的生命週期剛好等於「這一次啟動」——
     PWA 從主畫面重開＝新 session ⇒ 會播；
     切分頁、鎖屏解鎖、返回＝同一個 session ⇒ 不播。
     localStorage 會變成「一輩子只播一次」。
     ⚠️ 不准掛在 visibilitychange / focus / pageshow 上重播。
        bfcache 返回（pageshow.persisted）JS 根本不會重跑，什麼都不用做。
     ============================================================ */
  function isColdStart() {
    try {
      if (W.sessionStorage.getItem(SEEN_KEY)) return false;
      W.sessionStorage.setItem(SEEN_KEY, "1");
      return true;
    } catch (e) {
      return true; /* 隱私模式：寧可多播一次，不要整個 app 掛掉 */
    }
  }

  /* ============================================================
     6. 起手式（在 <head> 就跑完，body 還沒開始解析）
     ============================================================ */
  var builtin = clean(DEFAULTS);
  var cached = readCache();
  /* 快取優先，缺的欄位用 app 內建預設補。沒有快取就整個用內建預設。 */
  var LOOK = merge(builtin, cached);
  applyLook(LOOK);

  var COLD = isColdStart();
  if (!COLD) {
    /* 熱啟動：連一幀都不要畫出來（CSS: html[data-splash="off"] #splash{display:none}） */
    root.setAttribute("data-splash", "off");
  }

  /* ============================================================
     7. 收場（B 蓋住等待：資料好了就走，最短顯示 MIN_SHOW）
     ============================================================ */
  var runId = 0;
  var dismissed = false;
  var pendingDismiss = false;
  var manual = false;      /* app 有沒有宣告「我會自己說什麼時候好」 */
  var readyFired = false;

  function bootHosts() {
    try { return D.querySelectorAll(BOOT_SEL); } catch (e) { return []; }
  }

  function startBoot() {
    /* 銜接：收場動畫與內容進場要「重疊」不要「串接」。
       串接會有一個很明顯的空拍，那個空拍就是廉價感的來源。 */
    var hosts = bootHosts();
    if (!hosts || !hosts.length) return;
    var i;
    for (i = 0; i < hosts.length; i++) { hosts[i].classList.add("boot"); }
    later(function () {
      for (var j = 0; j < hosts.length; j++) { hosts[j].classList.remove("boot"); }
    }, BOOT_MS);
  }

  function hardRemove() {
    var sp = D.querySelector(SPLASH_SEL);
    if (sp && sp.parentNode) { sp.parentNode.removeChild(sp); }
    root.setAttribute("data-splash", "off");
  }

  function dismiss() {
    if (dismissed) return;
    var sp = D.querySelector(SPLASH_SEL);
    if (!sp) {
      /* body 還沒解析到 #splash（極端狀況）：先記著，DOM 好了立刻收 */
      pendingDismiss = true;
      return;
    }
    dismissed = true;
    var my = ++runId;
    clearTimers();
    sp.classList.add("out");
    startBoot();
    later(function () {
      if (my !== runId) return;
      /* ⚠️ 收掉之後要 remove()，不是 hidden：
         骨架屏的 shimmer 是 infinite 動畫，留著會一直吃 GPU。 */
      if (sp.parentNode) { sp.parentNode.removeChild(sp); }
      root.setAttribute("data-splash", "off");
      afterSplash();
    }, OUT_MS + 60);
  }

  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    /* 最短顯示還沒到就等一下，到了就立刻走 */
    later(dismiss, MIN_SHOW - elapsed());
  }

  /* ============================================================
     8. 保險絲（三重保護的第三層）
     ------------------------------------------------------------
     這兩條完全獨立於上面的流程：就算 ready 永遠不來、
     就算 dismiss 裡的 timer 被作廢，開場也一定會消失。
     ============================================================ */
  W.setTimeout(function () { dismiss(); }, FUSE);
  W.setTimeout(function () { hardRemove(); }, FUSE + 1500);

  /* ============================================================
     9. 跟 DOM 接上
     ============================================================ */
  function onDomReady(fn) {
    if (D.readyState === "loading") {
      D.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  onDomReady(function () {
    if (!COLD) {
      /* 熱啟動：開場節點直接拿掉，不留在 DOM 裡 */
      hardRemove();
      afterSplash();
      return;
    }
    if (pendingDismiss) { pendingDismiss = false; dismiss(); return; }
    /* 沒有宣告 hold() 的 app：等 load（所有資源到齊）就收。
       有資料要等的 app 一定要在最上面呼叫 Splash.hold()，
       否則 load 會先到、開場提早走，就蓋不住等待了。 */
    if (!manual) {
      if (D.readyState === "complete") { fireReady(); }
      else { W.addEventListener("load", function () { fireReady(); }, { once: true }); }
    }
  });

  /* ============================================================
     10. 鑰匙圈：開場播完之後才去讀，而且完全不阻塞任何東西
     ------------------------------------------------------------
     ⭐ 讀到的新外觀「不會套用到這一次的畫面」，只寫進快取
        ⇒ 改名要下一次冷啟動才生效。這是刻意的：
        中途換字會看到名字跳動，比晚一次生效難看得多。
        （下一個接手的人請不要把這件事當 bug「修好」。）
     ⭐ 失敗必須完全無感：沒網路、404、JSON 壞掉、格式不符
        一律吞掉、保留舊快取、絕不影響 app。
     ============================================================ */
  function afterSplash() {
    /* 再往後挪一點，確定不會跟收場動畫搶資源 */
    W.setTimeout(refreshFromKeyring, 400);
  }

  function refreshFromKeyring() {
    if (!KEYRING_URL) return;
    if (typeof W.fetch !== "function") return;

    var ctrl = null;
    try { if (typeof W.AbortController === "function") ctrl = new W.AbortController(); } catch (e) {}
    var to = W.setTimeout(function () {
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }, KEYRING_TIMEOUT);

    var opt = { cache: "no-store" };
    if (ctrl) opt.signal = ctrl.signal;

    W.fetch(KEYRING_URL, opt)
      .then(function (r) {
        if (!r || !r.ok) throw new Error("bad response");
        return r.json();
      })
      .then(function (j) {
        W.clearTimeout(to);
        absorb(j);
      })
      .catch(function () {
        W.clearTimeout(to);
        /* 安靜失敗。這裡刻意不 console.error：
           沒網路是常態，不是錯誤，不要在使用者的 console 留紅字。 */
      });
  }

  function absorb(j) {
    var apps = j && j.apps;
    if (!isArr(apps)) return;                 /* 格式不對 → 當作沒發生 */

    var me = null;
    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      if (a && typeof a === "object" && a.id === APP_ID) { me = a; break; }
    }
    if (!me) return;                          /* 這個 app 還沒登記 → 保留舊快取 */

    var look = clean(me.splash);
    if (isEmpty(look)) {
      /* 有登記、但沒有（或清空了）splash 設定
         ＝「我不要自訂了」 ⇒ 下次冷啟動回到 app 內建預設 */
      dropCache();
      return;
    }
    writeCache(look);
  }

  /* ============================================================
     11. 對外 API
     ============================================================ */
  W.Splash = {
    /* 有資料要等的 app：在最上面呼叫，宣告「我會自己說什麼時候好」 */
    hold: function () { manual = true; },
    /* 資料回來（成功或失敗都要）呼叫。失敗也要叫，
       不然開場會變成當機畫面、停到保險絲才收。 */
    ready: function () { fireReady(); },
    dismiss: function () { dismiss(); },
    /* QA／除錯用：看實際套用到的是什麼 */
    state: function () {
      return {
        cold: COLD,
        look: merge(LOOK, {}),
        onAccent: LOOK.accent ? onColor(LOOK.accent) : "(用 CSS 預設)",
        fromCache: !isEmpty(cached),
        dismissed: dismissed,
        elapsed: Math.round(elapsed()),
        minShow: MIN_SHOW,
        reduce: REDUCE,
        cacheKey: CACHE_KEY,
        keyringUrl: KEYRING_URL
      };
    }
  };
})();

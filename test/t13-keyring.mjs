/* t13 — 鑰匙圈（公開模式）的接法
   ⚠️ 這裡**不測鑰匙圈模組本身**（那是 xd1104/keyring 的正本，我們只是複製一份進來）。
      測的是「我們這邊的接法」：
        ・公開值拿得到 → 沒有登入畫面、直接看片單
        ・拿不到（404／沒有公開區塊／格式不對／模組壞掉／模組不見）→ **五種都要走到手貼逃生門**
        ・他自己貼的金鑰**優先於**公開值
        ・啟動路徑上碰模組的每一個點，四種壞法都不可以讓 App 打不開
   模組用一個**假的替身**注入（beforeEval）——真模組要 WebCrypto ＋ 真的 keyring.json。
   「模組真實行為」的假設（寫進哪個 storage、只吃一個 key、公開的 API）用**對正本檔案的靜態斷言**守住。 */
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";

const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const BLOBKEY = "hlm_keyring_blob";
const GOOD_BLOB = JSON.stringify({ tmdb: KEYS.GOOD_TMDB, omdb: KEYS.GOOD_OMDB });

/* 假的鑰匙圈。行為照正本的公開模式：
   ・init() 把**上次抓到的**公開值同步寫回 tokenKey（所以第二次開站不用等）
   ・網路那一趟結束後 whenReady() 才 resolve，值也才會進來
   o = { cached, plain, fail, slow, remember } */
function fakeKeyring(o) {
  return function (w) {
    var cfg = null, ready = false, waiters = [], isPub = false;
    function put(blob, remember) {
      if (remember === false) { w.sessionStorage.setItem(BLOBKEY, blob); w.localStorage.removeItem(BLOBKEY); }
      else { w.localStorage.setItem(BLOBKEY, blob); w.sessionStorage.removeItem(BLOBKEY); }
    }
    function land() {
      ready = true;
      if (!o.fail && o.plain != null) { isPub = true; put(o.plain, o.remember); }
      var ws = waiters; waiters = [];
      for (var i = 0; i < ws.length; i++) ws[i]({ unlocked: isPub, public: isPub, ready: true });
      if (isPub && cfg && cfg.onChange) cfg.onChange({ unlocked: true, public: true });
    }
    w.__kr = { cfg: null, reloads: 0, opened: 0, intro: 0 };
    w.Keyring = {
      init: function (c) {
        cfg = c; w.__kr.cfg = c;
        if (o.cached != null) { isPub = true; put(o.cached, o.remember); }
        w.setTimeout(land, o.slow ? 120 : 0);
        return { unlocked: isPub, public: isPub, ready: false };
      },
      whenReady: function () {
        if (ready) return Promise.resolve({ unlocked: isPub, public: isPub, ready: true });
        return new Promise(function (r) { waiters.push(r); });
      },
      isPublic: function () { return isPub; },
      isUnlocked: function () { return isPub; },
      reload: function () { w.__kr.reloads++; return Promise.resolve(); },
      chipHtml: function () { return isPub ? "" : '<button class="kr-chip">🔒 只看看模式</button>'; },
      maybeIntro: function () { w.__kr.intro++; },
      open: function () { w.__kr.opened++; },
      current: function () { return { unlocked: isPub, public: isPub }; },
      /* 測試用：模擬後台那邊之後才把值放上去／把公開關掉 */
      __land: function (plain) { isPub = true; put(plain, o.remember); cfg.onChange({ unlocked: true, public: true }); },
      __revoke: function () { isPub = false; w.localStorage.removeItem(BLOBKEY); w.sessionStorage.removeItem(BLOBKEY); cfg.onChange({ unlocked: false }); }
    };
  };
}
const bootKR = (o, opts) => boot({ ...(opts || {}), beforeEval: fakeKeyring(o || {}) });
const esc = (d) => html(d, "emptyBox");

section("47. 公開模式：打開網址就能用（沒有登入畫面、沒有設定金鑰那一頁）");
{
  const { w, d } = await bootKR({ plain: GOOD_BLOB });
  await tick(w, 200);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 公開值拆成兩把金鑰，寫進原本那兩個 key", w.localStorage.getItem("hlm_key_tmdb"));
  ok(w.localStorage.getItem("hlm_key_omdb") === JSON.stringify(KEYS.GOOD_OMDB), "★ OMDb 那把也有");
  ok(w.localStorage.getItem("hlm_keys_src") === JSON.stringify("keyring"), "記下來源是鑰匙圈");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 片單直接出來（端到端）",
    d.querySelectorAll(".row[data-open]").length);
  ok($(d, "view-setup").className.indexOf("on") < 0, "★ 不會被丟到設定頁");
  ok(!/現在還不能查片/.test(esc(d)), "★ 沒有錯誤畫面");
  ok(w.__kr.intro === 0, "★ 不呼叫 maybeIntro（公開模式不該彈解鎖）", w.__kr.intro);
  ok(w.__kr.opened === 0, "★ 也沒有任何地方去 open() 解鎖層");
  ok(!$(d, "krslot"), "★ 首頁沒有身分藥丸的位置了（公開模式沒有身分可言）");
  const cfg = w.__kr.cfg;
  ok(cfg.appId === "movie-library" && /^[\x20-\x7E]+$/.test(cfg.appId), "appId 是 ASCII、跟後台登記的一樣", cfg.appId);
  ok(cfg.tokenKey === BLOBKEY, "★ tokenKey 指到專用的新 key，不是 hlm_key_tmdb", cfg.tokenKey);
  ok(typeof cfg.onChange === "function", "有給 onChange（值之後變了要跟得上）");
}

section("48. 第二次打開：init() 同步就把上次的值放回來，連等都不用等");
{
  const { w, d } = await bootKR({ cached: GOOD_BLOB, plain: GOOD_BLOB, slow: true });
  await tick(w, 40);                      /* 網路那一趟還沒回來 */
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 快取的公開值立刻可用（沒有網路也打得開）");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 片單已經在了，不用等鑰匙圈");
  await tick(w, 200);
  ok(!/現在還不能查片/.test(esc(d)), "網路回來之後也沒有跳出錯誤");
}

section("49. 值晚一點才到：先顯示「正在拿金鑰」，到了自動補上片單");
{
  const { w, d } = await bootKR({ plain: GOOD_BLOB, slow: true });
  await tick(w, 40);
  ok(/正在拿金鑰/.test(esc(d)), "★ 還沒到 → 說「正在拿金鑰…」，不是先跳錯誤", esc(d).slice(0, 80));
  ok(!/自己貼金鑰/.test(esc(d)), "★ 這個階段不要先把逃生門推到他臉上");
  await tick(w, 250);
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 值到了自動補上片單（不用他按重試）");
}

section("50. ★ 五種拿不到金鑰的狀況，每一種都要走到手貼逃生門");
{
  const CASES = [
    ["keyring.json 404 / 抓不到", { fail: true }, false],
    ["抓得到但沒有這個 App 的公開區塊", { fail: true }, false],
    ["公開值格式不對（不是 JSON）", { plain: "這不是JSON" }, true],
    ["公開值裡沒有 tmdb", { plain: JSON.stringify({ omdb: "X" }) }, true],
    ["模組整支不見", null, false]
  ];
  for (const [why, o, badFormat] of CASES) {
    const b = o === null ? await boot() : await bootKR(o);
    await tick(b.w, 250);
    const h = esc(b.d);
    ok(/現在還不能查片/.test(h), "★ " + why + " → 首頁說清楚現在不能查片", h.slice(0, 90));
    if (badFormat) {
      /* ⭐ 格式不對就是**一個字都不要寫進去**：半套的空金鑰比沒有更難查 */
      ok(b.w.localStorage.getItem("hlm_key_tmdb") === null &&
         b.w.localStorage.getItem("hlm_key_omdb") === null &&
         b.w.localStorage.getItem("hlm_keys_src") === null,
        "★ " + why + " → 沒有寫進任何金鑰（不留半套狀態）",
        "tmdb=" + b.w.localStorage.getItem("hlm_key_tmdb") + " omdb=" + b.w.localStorage.getItem("hlm_key_omdb"));
      ok(/格式不對/.test(h), "★ " + why + " → 講的是「格式不對」這件事（不是一句籠統的錯誤）",
        h.slice(h.indexOf("現在還不能查片"), h.indexOf("現在還不能查片") + 160));
    }
    ok(!!$(b.d, "ktmdb") && !!$(b.d, "komdb") && !!$(b.d, "justSave"),
      "★ " + why + " → 手貼逃生門在（不會被鎖在門外）");
    ok(b.d.getElementById("view-setup").className.indexOf("on") < 0, "　　沒有被丟到設定頁");
    /* 當場貼金鑰就能用 */
    $(b.d, "ktmdb").value = KEYS.GOOD_TMDB;
    $(b.d, "justSave").click();
    await tick(b.w, 200);
    ok(b.d.querySelectorAll(".row[data-open]").length > 0, "★ " + why + " → 貼完當場就能查片");
  }
}

section("51. 手貼的金鑰**優先於**公開值");
{
  const { w, d } = await bootKR({ plain: GOOD_BLOB },
    { store: { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: "MYOWNOMDB" } });
  await tick(w, 250);
  ok(w.localStorage.getItem("hlm_key_omdb") === JSON.stringify("MYOWNOMDB"),
    "★ 公開值不可以蓋掉他自己貼的（他特地貼的最大）", w.localStorage.getItem("hlm_key_omdb"));
  ok(w.localStorage.getItem("hlm_keys_src") === null, "來源還是「手貼」");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "而且照樣能用");

  /* 設定頁：手貼過才會出現那一區，而且可以清掉改用鑰匙圈的 */
  $(d, "gear").click(); await tick(w, 60);
  const sh = html(d, "sbody");
  ok(/你自己貼的/.test(sh), "★ 設定頁講清楚「現在用的是你自己貼的」", sh.slice(sh.indexOf("金鑰"), sh.indexOf("金鑰") + 120));
  ok(!/id="ktmdb"/.test(sh), "★ 設定頁本身沒有手貼表單（那是逃生門的事）");
  ok(sh.indexOf(KEYS.GOOD_TMDB) < 0, "★ 設定頁不把金鑰原文印出來（只有遮罩）");
  $(d, "mkclear").click(); await tick(w, 200);
  ok(w.localStorage.getItem("hlm_key_omdb") === JSON.stringify(KEYS.GOOD_OMDB),
    "★ 清掉之後改吃鑰匙圈的公開值", w.localStorage.getItem("hlm_key_omdb"));
}

section("52. 重試按鈕：真的再抓一次");
{
  const { w, d } = await bootKR({ fail: true });
  await tick(w, 250);
  ok(!!$(d, "krretry"), "★ 拿不到時有「再試一次」");
  $(d, "krretry").click(); await tick(w, 400);
  ok(w.__kr.reloads === 1, "★ 按下去真的叫模組重抓一次", w.__kr.reloads);
  ok(/現在還不能查片/.test(esc(d)) && !!$(d, "ktmdb"), "還是拿不到 → 逃生門仍然在");
}

section("53. 後台把公開關掉／被收回：只清鑰匙圈給的，手貼的不准動");
{
  const { w, d } = await bootKR({ plain: GOOD_BLOB });
  await tick(w, 250);
  w.Keyring.__revoke();
  await tick(w, 200);
  ok(w.localStorage.getItem("hlm_key_tmdb") === null, "★ 鑰匙圈給的金鑰被清掉");
  ok(/現在還不能查片/.test(esc(d)) && !!$(d, "ktmdb"), "★ 而且立刻給逃生門");

  const b2 = await bootKR({ plain: GOOD_BLOB }, { store: { hlm_key_tmdb: KEYS.GOOD_TMDB } });
  await tick(b2.w, 250);
  b2.w.Keyring.__revoke();
  await tick(b2.w, 200);
  ok(b2.w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 他手貼的不可以被清掉", b2.w.localStorage.getItem("hlm_key_tmdb"));
  ok(b2.d.querySelectorAll(".row[data-open]").length > 0, "而且照樣在用");
}

section("54. 我們對「模組正本」的假設（靜態，模組改版時會紅）");
{
  const src = fs.readFileSync(R + "js/keyring-unlock.js", "utf8");
  /* 正本現在是可寫的那份 clone（xd1104/keyring 的唯讀 clone 已經落後了）。
     ⚠️ 不要為了「讓測試綠」放寬這條比對：它就是在擋「模組改版了但我們這份沒跟上」。 */
  const UPSTREAMS = ["/home/user/keyring/client/keyring-unlock.js",
                     "/home/user/xd1104/keyring/client/keyring-unlock.js"];
  const h = (x) => crypto.createHash("sha256").update(x).digest("hex");
  const up = UPSTREAMS.find((f) => fs.existsSync(f));
  if (up) {
    ok(h(src) === h(fs.readFileSync(up, "utf8")),
      "★ 我們這份跟正本一模一樣（不可以在這邊改它）", up + "\n      我們的 " + h(src).slice(0, 16));
  } else {
    ok(/global\.Keyring = API/.test(src) && /function chipHtml/.test(src),
      "（拿不到正本，改驗這份是不是完整的模組）");
  }
  ok(/tokenKey/.test(src) && /function writeToken\(token, remember\)/.test(src),
    "★ 假設一：一個 App 只吃一個 tokenKey（所以我們才要打包成 blob）");
  ok(/if \(remember\) \{ lsSet\(CFG\.tokenKey, token\); ssDel\(CFG\.tokenKey\); \}/.test(src) &&
     /else \{ ssSet\(CFG\.tokenKey, token\); lsDel\(CFG\.tokenKey\); \}/.test(src),
    "★ 假設二：remember 決定寫 localStorage 還是 sessionStorage");
  ok(/init: init/.test(src) && /isPublic:/.test(src) && /whenReady:/.test(src) && /reload:/.test(src),
    "★ 假設三：我們用到的四個 API 都在（init／isPublic／whenReady／reload）");
  ok(/public === true/.test(src) && /typeof a\.plain === "string"/.test(src),
    "★ 假設四：公開值認的是 apps[] 裡的 public:true ＋ plain（跟 iv／cipher 分得開）");

  const idx = fs.readFileSync(R + "index.html", "utf8");
  const iKr = idx.indexOf('<script src="./js/keyring-unlock.js">'), iCfg = idx.indexOf('<script src="./js/config.js">');
  ok(iKr >= 0 && iCfg >= 0 && iKr < iCfg, "★ index.html 在我們自己的 js 之前載入模組（兩行都要在）");
  const sw = fs.readFileSync(R + "sw.js", "utf8");
  ok(/"\.\/js\/keyring-unlock\.js"/.test(sw.split("self.addEventListener")[0]), "★ 有進 sw.js 的殼快取清單");
  const css = fs.readFileSync(R + "css/app.css", "utf8");
  ok(!/\.kr-|#kr-/.test(css), "★ 我們的 CSS 一條 kr- 規則都沒有");
  const cfg = fs.readFileSync(R + "js/config.js", "utf8");
  ok(/krAppId: "movie-library"/.test(cfg) && /krBlobKey: "hlm_keyring_blob"/.test(cfg), "config 的 appId／blobKey 正確");
  const uiSrc = fs.readFileSync(R + "js/ui.js", "utf8");
  ok(!/Keyring\./.test(uiSrc),
    "★ ui.js 完全不碰 Keyring（模組壞掉時錯誤畫面才畫得出來）");
}

section("55. ⭐ 模組壞掉的四種方式 × 每一個存取點（資料驅動，機械地打）");
{
  /* 判準是「boot() 這條路上總共碰了模組幾次」——`grep -rn "Keyring\." js/*.js` 現在是 3 個：
       ① krOn()          讀 window.Keyring 與 .init
       ② setupKeyring()  init()／whenReady()
       ③ 重試按鈕        reload()／whenReady()
     以後多呼叫模組一次，就在 POINTS 加一行，四種壞法自動跟著跑。 */
  const POINTS = ["init", "whenReady", "reload"];
  const MODES = [["missing", "少了這個方法（版本落差）"], ["throws", "一叫就爆"], ["getter", "連讀屬性都爆"]];

  function stub(method, mode) {
    return function (w) {
      const base = {
        init: function () { return { unlocked: false, ready: false }; },
        whenReady: function () { return Promise.resolve({ unlocked: false, ready: true }); },
        reload: function () { return Promise.resolve(); },
        isPublic: function () { return false; },
        isUnlocked: function () { return false; },
        chipHtml: function () { return ""; },
        maybeIntro: function () { },
        open: function () { },
        current: function () { return { unlocked: false }; }
      };
      if (mode === "missing") { delete base[method]; w.Keyring = base; return; }
      if (mode === "throws") { base[method] = function () { throw new Error("boom:" + method); }; w.Keyring = base; return; }
      const o = {};
      Object.keys(base).forEach(function (k) {
        if (k === method) Object.defineProperty(o, k, { get: function () { throw new Error("getter boom:" + method); } });
        else o[k] = base[k];
      });
      w.Keyring = o;
    };
  }
  function stubHostile() {
    return function (w) { Object.defineProperty(w, "Keyring", { configurable: true, get: function () { throw new Error("hostile"); } }); };
  }

  const CASES = [["（模組整支不存在）", null]];
  POINTS.forEach(m => MODES.forEach(([mode, why]) => CASES.push([m + "() " + why, stub(m, mode)])));
  CASES.push(["（讀 window.Keyring 就爆）", stubHostile()]);

  for (const [label, be] of CASES) {
    /* 逃生門 A：已經有金鑰的人（手貼過），四件事都要能做 */
    const { w, d } = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB }, beforeEval: be || undefined });
    await tick(w, 200);
    ok(d.querySelectorAll(".row[data-open]").length > 0, "★ " + label + "：片單還是出得來",
      d.querySelectorAll(".row[data-open]").length);
    $(d, "q").value = "沙丘";
    $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
    await tick(w, 150);
    ok(d.querySelectorAll(".row[data-open]").length > 0 || /查不到|沒有/.test(esc(d)), "　　搜尋有反應");
    $(d, "gear").click();
    await tick(w, 80);
    ok(/我訂了哪些平台/.test(html(d, "sbody")), "★ 　　進得了設定頁");

    /* 逃生門 B：完全沒金鑰（最慘的情境）——手貼那條路一定要在 */
    const b2 = await boot({ beforeEval: be || undefined });
    await tick(b2.w, 250);
    ok(!!$(b2.d, "ktmdb"), "★ 　　沒有金鑰時：手貼逃生門畫得出來", esc(b2.d).slice(0, 80));
    /* 按了「再試一次」之後也不可以卡在「正在拿金鑰…」回不來 */
    if ($(b2.d, "krretry")) {
      $(b2.d, "krretry").click();
      await tick(b2.w, 500);
      ok(!!$(b2.d, "ktmdb"), "★ 　　按重試之後逃生門還回得來（不會卡在「正在拿金鑰…」）",
        esc(b2.d).slice(0, 80));
    }
    if ($(b2.d, "ktmdb")) {
      $(b2.d, "ktmdb").value = KEYS.GOOD_TMDB;
      $(b2.d, "justSave").click();
      await tick(b2.w, 200);
      ok(b2.d.querySelectorAll(".row[data-open]").length > 0, "　　貼完當場就能查片");
    } else ok(false, "　　貼完當場就能查片（逃生門根本畫不出來）");
  }
}

section("56. 兩種來源交錯：公開值 → 手貼 → 清掉手貼");
{
  const LS = (w, k) => w.localStorage.getItem(k);
  const J = (v) => JSON.stringify(v);
  const { w, d } = await bootKR({ plain: GOOD_BLOB });
  await tick(w, 250);
  ok(LS(w, "hlm_key_tmdb") === J(KEYS.GOOD_TMDB) && LS(w, "hlm_keys_src") === J("keyring"), "1 公開值進來了");

  /* 手貼（從設定頁進不去，所以從逃生門那條路的表單元素直接呼叫同一個入口） */
  S_paste(w, d, "MANUAL_T", "MANUAL_O");
  await tick(w, 200);
  ok(LS(w, "hlm_key_tmdb") === J("MANUAL_T") && LS(w, "hlm_keys_src") === null,
    "2 手貼之後來源改成「手貼」", LS(w, "hlm_key_tmdb"));

  /* 公開值又變了 → 不可以蓋掉手貼的 */
  w.Keyring.__land(JSON.stringify({ tmdb: "NEWPUBLIC", omdb: "" }));
  await tick(w, 200);
  ok(LS(w, "hlm_key_tmdb") === J("MANUAL_T"), "★ 3 公開值變了也不能蓋掉手貼的", LS(w, "hlm_key_tmdb"));

  /* 清掉手貼 → 回到公開值 */
  $(d, "gear").click(); await tick(w, 60);
  $(d, "mkclear").click(); await tick(w, 250);
  ok(LS(w, "hlm_key_tmdb") === J("NEWPUBLIC"), "★ 4 清掉之後回到公開值", LS(w, "hlm_key_tmdb"));
}

function S_paste(w, d, t, o) {
  /* 逃生門不在畫面上時（已經有金鑰），直接用 store 的入口模擬「他在逃生門貼了金鑰」。
     ⚠️ 這裡**只呼叫 saveKeys**：清掉來源記號、清掉 session 副本都是 saveKeys 自己該做的事，
     測試幫它做的話，那幾件事就變成沒有人在驗（2026-08-24 突變測試抓到）。 */
  w.HLM_Store.saveKeys(t, o);
}

section("56b. 公開值進 sessionStorage 時（模組沒勾記住）：金鑰要跟著走，不可以留在裝置上");
{
  const LS = (w, k) => w.localStorage.getItem(k);
  const SS = (w, k) => w.sessionStorage.getItem(k);
  const J = (v) => JSON.stringify(v);
  /* 先讓裝置上留著一份「上一輪記住過」的舊金鑰，這一輪必須被清掉 */
  const { w, d } = await bootKR({ plain: GOOD_BLOB, remember: false },
    { store: { hlm_key_tmdb: "OLD_DEVICE_KEY", hlm_key_omdb: "OLD_DEVICE_OMDB", hlm_keys_src: "keyring" } });
  await tick(w, 250);
  ok(SS(w, "hlm_key_tmdb") === J(KEYS.GOOD_TMDB),
    "★ 值跟著 blob 進 sessionStorage", SS(w, "hlm_key_tmdb"));
  ok(LS(w, "hlm_key_tmdb") === null && LS(w, "hlm_key_omdb") === null,
    "★ localStorage 上一輪留下的舊金鑰要被清掉（不然會留在別人的裝置上）",
    "tmdb=" + LS(w, "hlm_key_tmdb") + " omdb=" + LS(w, "hlm_key_omdb"));
  ok(w.HLM_Store.keys().tmdb === KEYS.GOOD_TMDB, "keys() 讀得到（session 優先）");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "端到端：真的拿 session 那把去打 API");

  /* 這時候他自己貼一把 → 手貼寫 localStorage，session 的舊副本要清掉、來源要改回手貼 */
  S_paste(w, d, "MANUAL_T2", "MANUAL_O2");
  await tick(w, 150);
  ok(LS(w, "hlm_key_tmdb") === J("MANUAL_T2"), "手貼寫進 localStorage");
  ok(SS(w, "hlm_key_tmdb") === null,
    "★ session 的舊副本要清掉（keys() 是 session 優先，不清就會被舊的蓋住）", SS(w, "hlm_key_tmdb"));
  ok(LS(w, "hlm_keys_src") === null,
    "★ 來源要改回「手貼」（不然下次公開值變了會蓋掉他貼的）", LS(w, "hlm_keys_src"));
  ok(w.HLM_Store.keys().tmdb === "MANUAL_T2", "keys() 現在回手貼那把");
}

section("57. 兩邊同時有金鑰時：session 的優先（層 B 的備援，單獨驗）");
{
  const { w, d } = await boot({
    store: { hlm_key_tmdb: "OLD_LS_KEY_不該被用到", hlm_key_omdb: "OLD_LS_OMDB" },
    beforeEval: function (ww) {
      ww.sessionStorage.setItem("hlm_key_tmdb", JSON.stringify(KEYS.GOOD_TMDB));
      ww.sessionStorage.setItem("hlm_key_omdb", JSON.stringify(KEYS.GOOD_OMDB));
    }
  });
  await tick(w, 200);
  ok(w.HLM_Store.keys().tmdb === KEYS.GOOD_TMDB, "★ 兩邊都有時 keys() 回 session 那把", w.HLM_Store.keys().tmdb);
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 端到端：真的是拿 session 那把去打 API");
}

process.exit(summary() ? 1 : 0);

/* t13 — 鑰匙圈（跨 App 身分）的接法
   ⚠️ 這裡**不測鑰匙圈模組本身**（那是 xd1104/keyring 的正本，我們只是複製一份進來）。
      測的是「我們這邊的接法」：blob 拆成兩把金鑰、格式錯誤要有人話、只有 tmdb 也能用、
      解不開時降級成手貼那條路、離線抓不到 keyring.json 時不要把人踢回去。
   模組用一個**假的替身**注入（beforeEval）——真模組要 WebCrypto ＋ 真的 keyring.json。
   「模組真實行為」的假設（寫進哪個 storage、只吃一個 key）改用**對正本檔案的靜態斷言**守住。 */
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";

const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const BLOBKEY = "hlm_keyring_blob";
const GOOD_BLOB = JSON.stringify({ tmdb: KEYS.GOOD_TMDB, omdb: KEYS.GOOD_OMDB });

/* 假的鑰匙圈：只實作我們真的有用到的那幾個 API，行為照正本
   （init 會同步把記住的內容寫回 tokenKey；remember=false 走 sessionStorage）。 */
function fakeKeyring(o) {
  return function (w) {
    var cfg = null, unlocked = !!o.unlocked;
    function put(blob, remember) {
      if (remember === false) { w.sessionStorage.setItem(BLOBKEY, blob); w.localStorage.removeItem(BLOBKEY); }
      else { w.localStorage.setItem(BLOBKEY, blob); w.sessionStorage.removeItem(BLOBKEY); }
    }
    w.__kr = { intro: 0, opened: 0, cfg: null };
    w.Keyring = {
      init: function (c) {
        cfg = c; w.__kr.cfg = c;
        if (unlocked && o.blob != null) put(o.blob, o.remember !== false);
        return { unlocked: unlocked };
      },
      isUnlocked: function () { return unlocked; },
      chipHtml: function () {
        return unlocked ? '<button class="kr-chip">Benson・可以編輯</button>'
          : '<button class="kr-chip">🔒 只看看模式・<span class="kr-cta">點我解鎖 ›</span></button>';
      },
      maybeIntro: function () { w.__kr.intro++; },
      open: function () { w.__kr.opened++; },
      current: function () { return { unlocked: unlocked }; },
      /* 測試用：模擬使用者當場解鎖／被收回 */
      __unlock: function (blob, remember) { unlocked = true; put(blob, remember !== false); cfg.onChange({ unlocked: true, name: "Benson" }); },
      __forget: function () { unlocked = false; w.localStorage.removeItem(BLOBKEY); w.sessionStorage.removeItem(BLOBKEY); cfg.onChange({ unlocked: false }); }
    };
  };
}
const bootKR = (o, opts) => boot({ ...(opts || {}), beforeEval: fakeKeyring(o) });

section("47. 解鎖過的裝置：blob 拆成兩把金鑰，直接進片單");
{
  const { w, d } = await bootKR({ unlocked: true, blob: GOOD_BLOB });
  await tick(w, 150);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ TMDB 金鑰從 blob 拆出來寫進原本那個 key", w.localStorage.getItem("hlm_key_tmdb"));
  ok(w.localStorage.getItem("hlm_key_omdb") === JSON.stringify(KEYS.GOOD_OMDB), "★ OMDb 那把也有");
  ok(w.localStorage.getItem("hlm_keys_src") === JSON.stringify("keyring"), "記下來源是鑰匙圈");
  ok($(d, "view-setup").className.indexOf("on") < 0, "★ 不會被丟到「還不能用」的設定頁");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 片單真的載出來了（端到端）",
    d.querySelectorAll(".row[data-open]").length);
  ok(!$(d, "gear").classList.contains("warn"), "齒輪沒有警告記號");
  ok(/kr-chip/.test(html(d, "krslot")), "★ 首頁 footer 有身分藥丸");
  ok(w.__kr.intro === 1, "★ 首頁畫完呼叫了一次 maybeIntro", w.__kr.intro);
  const cfg = w.__kr.cfg;
  ok(cfg.appId === "movie-library" && /^[\x20-\x7E]+$/.test(cfg.appId), "★ appId 是 ASCII 而且跟 repo 同名", cfg.appId);
  ok(cfg.tokenKey === BLOBKEY, "★ tokenKey 指到專用的新 key，不是 hlm_key_tmdb", cfg.tokenKey);
  ok(cfg.appName === "🎬 好雷嗎", "appName", cfg.appName);
  ok(typeof cfg.toast === "function" && typeof cfg.onChange === "function", "toast / onChange 都有給");
}

section("48. 當場解鎖：從「還不能用」直接跳到片單");
{
  const { w, d } = await bootKR({ unlocked: false });
  await tick(w, 120);
  ok($(d, "view-setup").className.indexOf("on") >= 0, "沒金鑰 → 先看到設定頁");
  ok(/用鑰匙圈（最快）|用鑰匙圈/.test(html(d, "sbody")), "★ 引導畫面有講鑰匙圈這條路");
  ok(/ktmdb/.test(html(d, "sbody")), "★ 同一頁也留著手貼那條路（兩條並存）");
  ok(/kr-chip/.test(html(d, "krslot2")), "設定頁也有藥丸可以點解鎖");

  w.Keyring.__unlock(GOOD_BLOB, true);
  await tick(w, 200);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "★ 解鎖後金鑰進來了");
  ok($(d, "view-setup").className.indexOf("on") < 0 && $(d, "view-home").style.display !== "none",
    "★ 自動離開設定頁，直接看片單");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "片單載出來了");
}

section("49. blob 格式不對：人話錯誤 + 手貼那條路還在（主流程，不是邊緣案例）");
{
  for (const [bad, why] of [
    [KEYS.GOOD_TMDB, "整串貼成裸金鑰（沒包成 JSON）"],
    ["{tmdb:'x'}", "JSON 打錯（單引號／沒引號）"],
    ['{"omdb":"OMDBGOOD"}', "只有 omdb 沒有 tmdb"],
    ['["a","b"]', "貼成陣列"],
    ["   ", "空白"]
  ]) {
    const { w, d } = await bootKR({ unlocked: true, blob: bad });
    await tick(w, 150);
    ok(w.localStorage.getItem("hlm_key_tmdb") === null, "★ " + why + " → 不會寫進任何金鑰");
    ok($(d, "view-setup").className.indexOf("on") >= 0, "　　停在設定頁（不是白畫面）");
    const h = html(d, "sbody");
    ok(/鑰匙圈裡的內容格式不對/.test(h), "　　★ 設定頁講人話說格式不對");
    const txt2 = $(d, "sbody").textContent;
    ok(txt2.indexOf('{"tmdb":"') >= 0 && txt2.indexOf('"omdb"') >= 0,
      "　　★ 而且直接告訴他正確格式長怎樣", txt2.slice(txt2.indexOf("格式不對"), txt2.indexOf("格式不對") + 120));
    ok(/ktmdb/.test(h), "　　手貼那條路還在");
  }
  /* 格式壞掉之後，自己貼一樣要能用 */
  const { w, d } = await bootKR({ unlocked: true, blob: "壞掉的東西" });
  await tick(w, 150);
  $(d, "ktmdb").value = KEYS.GOOD_TMDB;
  $(d, "justSave").click();
  await tick(w, 60);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "★ 鑰匙圈壞掉時手貼照樣存得進去");
  ok(w.localStorage.getItem("hlm_keys_src") === null, "★ 手貼的不會被記成鑰匙圈來源（之後不可以被清掉）");
}

section("50. 只有 tmdb 沒有 omdb 也要能用");
{
  const { w, d } = await bootKR({ unlocked: true, blob: '{"tmdb":"' + KEYS.GOOD_TMDB + '"}' });
  await tick(w, 150);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "TMDB 進來了");
  ok(w.localStorage.getItem("hlm_key_omdb") === JSON.stringify(""), "OMDb 是空的");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 片單照樣能用");
  [...d.querySelectorAll(".row[data-open]")][0].click();
  await tick(w, 200);
  ok(/查無收錄|還沒設定 OMDb|資料不足|還無法判斷/.test(html(d, "dbody")) || /sc"/.test(html(d, "dbody")),
    "★ 詳細頁不會壞掉（少三個分數而已）");
  ok(!/undefined/.test(html(d, "dbody")), "畫面上沒有 undefined");
  /* omdb 空字串也要能被 blob 明確表示 */
  const b2 = await bootKR({ unlocked: true, blob: '{"tmdb":"' + KEYS.GOOD_TMDB + '","omdb":""}' });
  await tick(b2.w, 120);
  ok(b2.w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "omdb 給空字串也 OK");
}

section("51. 沒勾「記住這台裝置」：金鑰不可以留在別人的電腦上");
{
  const { w, d } = await bootKR({ unlocked: true, blob: GOOD_BLOB, remember: false });
  await tick(w, 150);
  ok(w.sessionStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 金鑰跟著 blob 進 sessionStorage", w.sessionStorage.getItem("hlm_key_tmdb"));
  ok(w.localStorage.getItem("hlm_key_tmdb") === null,
    "★ localStorage 一個字都不留（關掉分頁就沒了）", w.localStorage.getItem("hlm_key_tmdb"));
  ok(d.querySelectorAll(".row[data-open]").length > 0, "這個 session 照樣能用");
}

section("52. 被收回／換人／換密碼：只清鑰匙圈給的，手貼的不准動");
{
  const { w, d } = await bootKR({ unlocked: true, blob: GOOD_BLOB });
  await tick(w, 150);
  w.Keyring.__forget();
  await tick(w, 120);
  ok(w.localStorage.getItem("hlm_key_tmdb") === null, "★ 鑰匙圈給的金鑰被清掉");
  ok(w.localStorage.getItem("hlm_keys_src") === null, "來源記號也清掉");
  ok($(d, "gear").classList.contains("warn"), "齒輪變成警告，他知道要重設");

  /* 手貼的不可以被清 */
  const b2 = await bootKR({ unlocked: false }, { store: { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB } });
  await tick(b2.w, 150);
  b2.w.Keyring.__forget();
  await tick(b2.w, 120);
  ok(b2.w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 他自己手貼的金鑰不可以被鑰匙圈清掉", b2.w.localStorage.getItem("hlm_key_tmdb"));
  ok(b2.d.querySelectorAll(".row[data-open]").length > 0, "而且照樣在用");
}

section("53. 離線／模組壞掉：不可以把人踢回去，也不可以打不開");
{
  /* 抓不到 keyring.json → 真模組什麼都不做（不會呼叫 onChange），我們這邊要維持現狀 */
  const { w, d } = await bootKR({ unlocked: true, blob: GOOD_BLOB });
  await tick(w, 200);
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB),
    "★ 沒有任何 onChange 進來時，金鑰維持原狀");
  ok(d.querySelectorAll(".row[data-open]").length > 0, "★ 離線也不會被踢回「還不能用」");

  /* 模組整個沒載到（CDN 掛掉／檔案漏了）→ App 一定要照常走手貼那條路 */
  const b2 = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB } });
  await tick(b2.w, 150);
  ok(b2.d.querySelectorAll(".row[data-open]").length > 0, "★ 完全沒有 Keyring 也能用");
  ok(html(b2.d, "krslot") === "", "沒有模組就不畫藥丸（不是留一個壞掉的殼）");
  b2.d.getElementById("gear").click();
  await tick(b2.w, 60);
  ok(!/用鑰匙圈/.test(html(b2.d, "sbody")), "★ 沒有模組時設定頁不提鑰匙圈（不要給他一條走不通的路）");

  /* 模組自己丟例外也不可以讓 App 打不開 */
  const b3 = await boot({
    store: { hlm_key_tmdb: KEYS.GOOD_TMDB },
    beforeEval: function (w) { w.Keyring = { init: function () { throw new Error("boom"); } }; }
  });
  await tick(b3.w, 150);
  ok(b3.d.querySelectorAll(".row[data-open]").length > 0, "★ Keyring.init 丟例外，App 照常跑完 boot()");
}

section("54. 我們對「模組正本」的假設（靜態，模組改版時會紅）");
{
  const src = fs.readFileSync(R + "js/keyring-unlock.js", "utf8");
  const up = "/home/user/xd1104/keyring/client/keyring-unlock.js";
  const h = s => crypto.createHash("sha256").update(s).digest("hex");
  if (fs.existsSync(up)) {
    ok(h(src) === h(fs.readFileSync(up, "utf8")),
      "★ 我們這份跟 xd1104/keyring 的正本一模一樣（不可以在這邊改它）");
  } else {
    ok(/global\.Keyring = API/.test(src) && /function chipHtml/.test(src),
      "（拿不到正本，改驗這份是不是完整的模組）");
  }
  ok(/tokenKey/.test(src) && /function writeToken\(token, remember\)/.test(src),
    "★ 假設一：一個 App 只吃一個 tokenKey（所以我們才要打包成 blob）");
  ok(/if \(remember\) \{ lsSet\(CFG\.tokenKey, token\); ssDel\(CFG\.tokenKey\); \}/.test(src) &&
     /else \{ ssSet\(CFG\.tokenKey, token\); lsDel\(CFG\.tokenKey\); \}/.test(src),
    "★ 假設二：remember 決定寫 localStorage 還是 sessionStorage（我們的兩把金鑰跟著同一個地方走）");
  ok(/init: init/.test(src) && /chipHtml: chipHtml/.test(src) && /maybeIntro: maybeIntro/.test(src) &&
     /isUnlocked:/.test(src), "★ 假設三：我們用到的四個 API 都在");
  ok(/onChange/.test(src), "★ 假設四：有 onChange 回呼");

  const idx = fs.readFileSync(R + "index.html", "utf8");
  /* ⚠️ 先確認兩個都真的存在再比順序：只比 indexOf 的話，
     「整行被刪掉」會得到 -1 < 正數 ＝ 通過，那條就空轉了。 */
  const iKr = idx.indexOf('<script src="./js/keyring-unlock.js">'), iCfg = idx.indexOf('<script src="./js/config.js">');
  ok(iKr >= 0 && iCfg >= 0 && iKr < iCfg,
    "★ index.html 在我們自己的 js 之前載入模組（而且兩行都要在）", "kr=" + iKr + " cfg=" + iCfg);
  ok(/<script src="\.\/js\/keyring-unlock\.js"><\/script>/.test(idx), "路徑是相對的 ./");
  const sw = fs.readFileSync(R + "sw.js", "utf8");
  ok(/"\.\/js\/keyring-unlock\.js"/.test(sw.split("self.addEventListener")[0]),
    "★ 有進 sw.js 的殼快取清單（PWA 離線也要有）");
  const css = fs.readFileSync(R + "css/app.css", "utf8");
  ok(!/\.kr-|#kr-/.test(css),
    "★ 我們的 CSS 一條 kr- 規則都沒有（解鎖畫面是跨 App 公版，不准在這裡調）");
  const cfg = fs.readFileSync(R + "js/config.js", "utf8");
  ok(/krAppId: "movie-library"/.test(cfg), "appId 寫在 config，跟 repo 同名");
  ok(/krBlobKey: "hlm_keyring_blob"/.test(cfg), "★ blob 存在專用 key，不會蓋到手貼的金鑰");
  ok(!/krBlobKey: "hlm_key_tmdb"/.test(cfg), "tokenKey 不可以直接指到金鑰 key");
}

section("55. ⭐ 模組壞掉的四種方式 × 每一個存取點（資料驅動，機械地打）");
{
  /* QA 2026-08-23 退件 K-1 的教訓：包 try/catch 不等於包對地方。
     判準是「boot() 這條路上總共碰了模組幾次」——`grep -rn "Keyring\." js/*.js` 目前 5 個：
       ① krOn()            讀 window.Keyring 與 .init
       ② krPaintChip()     chipHtml()
       ③ setupKeyring()    init()          ← 守衛是啟動那段的 try/catch
       ④ renderSetup()     isUnlocked()    ← K-1 漏的就是這個
       ⑤ showHome()        maybeIntro()
     以後多呼叫模組一次，就在 POINTS 加一行，四種壞法自動跟著跑。 */
  const POINTS = ["init", "isUnlocked", "chipHtml", "maybeIntro"];
  const MODES = [["missing", "少了這個方法（版本落差）"], ["throws", "一叫就爆"], ["getter", "連讀屬性都爆"]];

  function stub(method, mode) {
    return function (w) {
      const base = {
        init: function () { return { unlocked: false }; },
        isUnlocked: function () { return false; },
        chipHtml: function () { return '<button class="kr-chip">chip</button>'; },
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
  /* 連「整個 Keyring 讀了就爆」也要試（QA 實測過這種） */
  function stubHostile() {
    return function (w) { Object.defineProperty(w, "Keyring", { configurable: true, get: function () { throw new Error("hostile"); } }); };
  }

  const CASES = [["（模組整支不存在）", null]];
  POINTS.forEach(m => MODES.forEach(([mode, why]) => CASES.push([m + "() " + why, stub(m, mode)])));
  CASES.push(["（讀 window.Keyring 就爆）", stubHostile()]);

  for (const [label, be] of CASES) {
    /* 逃生門 A：已經有金鑰的人，四件事都要能做 */
    const { w, d } = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB }, beforeEval: be || undefined });
    await tick(w, 150);
    const rows = d.querySelectorAll(".row[data-open]").length;
    ok(rows > 0, "★ " + label + "：片單還是出得來", rows);
    $(d, "q").value = "沙丘";
    $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
    await tick(w, 150);
    ok(d.querySelectorAll(".row[data-open]").length > 0 || /查不到|沒有/.test(html(d, "emptyBox")),
      "　　搜尋有反應");
    $(d, "gear").click();
    await tick(w, 80);
    ok(!!$(d, "ktmdb"), "★ 　　進得了設定頁（手貼的逃生門還在）");
    if ($(d, "ktmdb")) {
      $(d, "ktmdb").value = KEYS.GOOD_TMDB;
      $(d, "justSave").click();
      await tick(w, 60);
      ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "　　手貼存得進去");
    } else ok(false, "　　手貼存得進去（設定頁根本畫不出來）");

    /* 逃生門 B：第一次使用（完全沒金鑰）——這是最慘的情境，設定頁一定要畫得出來 */
    const b2 = await boot({ beforeEval: be || undefined });
    await tick(b2.w, 150);
    ok(!!$(b2.d, "ktmdb"), "★ 　　沒有金鑰時：引導畫面畫得出來", html(b2.d, "sbody").slice(0, 80));
    if ($(b2.d, "ktmdb")) {
      $(b2.d, "ktmdb").value = KEYS.GOOD_TMDB;
      $(b2.d, "justSave").click();
      await tick(b2.w, 150);
      ok(b2.w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "　　第一次使用也貼得進去");
    } else ok(false, "　　第一次使用也貼得進去（畫不出來）");
  }
}

section("56. 解鎖了但後台那一格是空的（老闆很可能遇到的第一個狀態）");
{
  const { w, d } = await bootKR({ unlocked: true, blob: '{"tmdb":"","omdb":""}' });
  await tick(w, 150);
  const h = html(d, "sbody"), t = $(d, "sbody").textContent;
  ok($(d, "view-setup").className.indexOf("on") >= 0, "沒金鑰 → 停在設定頁");
  ok(!/下面那兩格會自動填好/.test(t), "★ 不可以說「兩格會自動填好」（兩格是空的，那是騙人）");
  ok(/還沒放這個 App 的金鑰/.test(t), "★ 明講「鑰匙圈解開了，但裡面還沒放這個 App 的金鑰」");
  ok(t.indexOf('{"tmdb":"') >= 0 && /movie-library/.test(t), "★ 告訴他下一步：貼什麼、代號填什麼");
  ok(/warnmark/.test(h), "用琥珀警告框，不是普通說明");
  ok(!!$(d, "ktmdb") && !!$(d, "saveTest"), "手貼那條路還在");

  /* 對照組：真的有金鑰時才可以說「自動填好」 */
  const b2 = await bootKR({ unlocked: true, blob: GOOD_BLOB });
  await tick(b2.w, 150);
  $(b2.d, "gear").click(); await tick(b2.w, 80);
  const t2 = $(b2.d, "sbody").textContent;
  ok(/下面那兩格會自動填好/.test(t2), "★ 對照組：金鑰真的進來了才這樣講");
  ok(!/還沒放這個 App 的金鑰/.test(t2), "而且不會同時出現另一種文案");
  ok($(b2.d, "ktmdb").value === KEYS.GOOD_TMDB, "兩格真的填好了", $(b2.d, "ktmdb").value);
}

section("57. 兩種金鑰來源交錯：手貼 → 鑰匙圈(記住) → 鑰匙圈(不記住) → 手貼 → 收回");
{
  const LS = (w, k) => w.localStorage.getItem(k);
  const SS = (w, k) => w.sessionStorage.getItem(k);
  const J = v => JSON.stringify(v);
  const blob = (t, o) => JSON.stringify({ tmdb: t, omdb: o });
  const paste = async (w, d, t, o) => {
    if ($(d, "view-setup").className.indexOf("on") < 0) { $(d, "gear").click(); await tick(w, 80); }
    $(d, "ktmdb").value = t; $(d, "komdb").value = o;
    $(d, "justSave").click(); await tick(w, 80);
  };

  const { w, d } = await bootKR({ unlocked: false });
  await tick(w, 150);
  ok(!!$(d, "saveTest"), "★ 有鑰匙圈時，手貼的「儲存並測試」鈕不可以消失");

  /* 1) 手貼 */
  await paste(w, d, KEYS.GOOD_TMDB, KEYS.GOOD_OMDB);
  ok(LS(w, "hlm_key_tmdb") === J(KEYS.GOOD_TMDB) && SS(w, "hlm_key_tmdb") === null, "1 手貼 → 只在 localStorage");
  ok(LS(w, "hlm_keys_src") === null, "1 來源不是鑰匙圈");

  /* 2) 鑰匙圈（勾記住） */
  w.Keyring.__unlock(blob("KR_T2", "KR_O2"), true);
  await tick(w, 150);
  ok(LS(w, "hlm_key_tmdb") === J("KR_T2") && SS(w, "hlm_key_tmdb") === null, "2 記住 → 蓋掉 localStorage、session 空的");
  ok(LS(w, "hlm_keys_src") === J("keyring"), "2 來源記成 keyring");

  /* 3) 鑰匙圈（不勾記住）——上一輪留在 localStorage 的那份一定要清掉 */
  w.Keyring.__unlock(blob("KR_T3", "KR_O3"), false);
  await tick(w, 150);
  ok(SS(w, "hlm_key_tmdb") === J("KR_T3"), "3 不記住 → 進 sessionStorage");
  ok(LS(w, "hlm_key_tmdb") === null,
    "★ 3 上一次「記住」留在 localStorage 的舊金鑰要被清掉（不然還躺在那台裝置上）", LS(w, "hlm_key_tmdb"));
  ok(LS(w, "hlm_key_omdb") === null, "3 OMDb 那把也一樣");

  /* 4) 又改回手貼——session 的舊金鑰要清掉，來源記號也要清掉 */
  await paste(w, d, "MANUAL_T4", "MANUAL_O4");
  ok(LS(w, "hlm_key_tmdb") === J("MANUAL_T4"), "4 手貼 → 寫 localStorage");
  ok(SS(w, "hlm_key_tmdb") === null,
    "★ 4 session 的舊金鑰要清掉（keys() 是 session 優先，不清就會被舊的蓋住）", SS(w, "hlm_key_tmdb"));
  ok(LS(w, "hlm_keys_src") === null,
    "★ 4 來源要改回「手貼」（不然下次鑰匙圈被收回會把他手貼的一起清掉）", LS(w, "hlm_keys_src"));

  /* 5) 鑰匙圈被收回——這時候手上的是手貼的，不准動 */
  w.Keyring.__forget();
  await tick(w, 120);
  ok(LS(w, "hlm_key_tmdb") === J("MANUAL_T4"), "★ 5 收回不可以清掉他手貼的金鑰", LS(w, "hlm_key_tmdb"));
  ok(!$(d, "gear").classList.contains("warn"), "5 還是可以用");

  /* 6) 再解鎖一次然後收回——這次是鑰匙圈給的，就要清掉 */
  w.Keyring.__unlock(blob("KR_T6", "KR_O6"), true);
  await tick(w, 150);
  ok(LS(w, "hlm_key_tmdb") === J("KR_T6"), "6 鑰匙圈再蓋一次");
  w.Keyring.__forget();
  await tick(w, 120);
  ok(LS(w, "hlm_key_tmdb") === null && SS(w, "hlm_key_tmdb") === null, "★ 6 這次要清乾淨（兩邊都清）");
}

section("58. 兩邊同時有金鑰時：session 的優先（層 B 的備援，要單獨驗）");
{
  /* N13 那條 del() 正常時，兩邊不會同時有東西 → 優先順序看不出差別。
     但它是「舊版留下的 localStorage 副本 ＋ 這次不記住的解鎖」那個情境的最後一道，
     所以直接把兩邊都塞滿來驗一次（不然這條規則等於沒人在守）。 */
  const { w, d } = await boot({
    store: { hlm_key_tmdb: "OLD_LS_KEY_不該被用到", hlm_key_omdb: "OLD_LS_OMDB" },
    beforeEval: function (ww) {
      ww.sessionStorage.setItem("hlm_key_tmdb", JSON.stringify(KEYS.GOOD_TMDB));
      ww.sessionStorage.setItem("hlm_key_omdb", JSON.stringify(KEYS.GOOD_OMDB));
    }
  });
  await tick(w, 150);
  ok(w.HLM_Store.keys().tmdb === KEYS.GOOD_TMDB,
    "★ 兩邊都有時 keys() 回 session 那把", w.HLM_Store.keys().tmdb);
  ok(w.HLM_Store.keys().omdb === KEYS.GOOD_OMDB, "OMDb 也一樣");
  ok(d.querySelectorAll(".row[data-open]").length > 0,
    "★ 端到端：真的是拿 session 那把去打 API（用 localStorage 那把會查不到）",
    html(d, "emptyBox").slice(0, 80));
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify("OLD_LS_KEY_不該被用到"),
    "（沒有偷偷改動 localStorage 那份）");
}

process.exit(summary() ? 1 : 0);

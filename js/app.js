/* 好雷嗎? — 主控（狀態、路由、事件）
   資料流鐵律：中文片名 → TMDB 拿 tmdb_id / imdb_id → 用 imdb_id 打 OMDb 拿三個分數。
   詳細頁一定是漸進顯示：TMDB 先畫，OMDb 用骨架佔位、到了再補。不可以改成「等齊再顯示」。 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var UI = HLM_UI, Api = HLM_Api, S = HLM_Store, C = HLM_CFG;

  /* ---------- 開場畫面（js/splash.js）----------
     ⚠️ 一定要寫成 window.Splash && …，**不可以裸寫 Splash.hold()**。
     那支模組載不到的時候（離線、SW 沒預快取、部署漏檔）裸寫會丟 ReferenceError
     ⇒ 整支 app.js 的 IIFE 當場中止 ⇒ 0 筆資料、沒套樣式的 #splash 永遠卡在畫面上，
     而且**保險絲就住在那支沒載到的檔案裡**，不會有人來救。
     （範本那一輪 QA 實測過的災情，見 lab 手冊 D 段。）
     這支 App 的測試治具（test/harness.mjs）本來就會把所有 <script src> 拿掉，
     所以 t1～t13 每一支都是在「沒有 Splash」的情況下跑的 ＝ 天然的負控組。 */
  var hasSplash = !!(window.Splash && window.Splash.hold && window.Splash.ready);
  if (hasSplash) { try { Splash.hold(); } catch (e) { hasSplash = false; } }
  if (!hasSplash) splashFallback();

  function splashFallback() {
    /* 自己把開場收掉。全螢幕的東西卡住＝App 打不開，比白畫面嚴重一個等級。 */
    try {
      var sp = document.getElementById("splash");
      if (sp && sp.parentNode) sp.parentNode.removeChild(sp);
      document.documentElement.setAttribute("data-splash", "off");
    } catch (e) { }
    /* splash.js 平常會掛這一行；沒有它的話 iOS Safari 的 :active 不會觸發
       ＝ 手機上所有按下回饋都是死的。 */
    try { document.addEventListener("touchstart", function () { }, { passive: true }); }
    catch (e) { try { document.addEventListener("touchstart", function () { }, false); } catch (e2) { } }
  }

  /* 資料回來（成功或失敗都要）就叫一次，開場才會收 —— 失敗也要叫，
     不然開場會變成當機畫面、要停到 6 秒的保險絲才走。
     只認第一次：之後的重載片單、切分頁都不該再影響開場。 */
  var splashDone = false;
  function splashReady() {
    if (splashDone) return;
    splashDone = true;
    if (window.Splash && window.Splash.ready) { try { Splash.ready(); } catch (e) { } }
  }

  /* ---------- 狀態 ---------- */
  var state = {
    tab: S.get("hlm_tab", "cinema") === "stream" ? "stream" : "cinema",
    sort: readSortPref(),
    pf: S.get("hlm_pf", null),
    mysubs: S.get("hlm_mysubs", []) || [],
    recent: S.get("hlm_recent", []) || [],
    query: "",
    homeScroll: 0,
    view: "home",
    cinemaIds: {}
  };
  function knownBrand(k) { return !!HLM_BRAND[k]; }

  /* 排序偏好。2026-08-23 老闆要求電影院與串流**都預設依熱門**（理由見 CLAUDE.md 第 11 條）。
     ⚠️ 刻意換一個新的 key `hlm_sort2`：他手上那台已經存著舊的 hlm_sort="score"，
     只改預設值的話那台會繼續吃舊值、等於沒改。換 key 讓所有裝置**拿一次新預設**，
     之後再尊重他自己的選擇。舊 key 順手清掉，不要留著讓人以為它還有用。 */
  function readSortPref() {
    var v = S.get("hlm_sort2", null);
    if (v === "pop" || v === "score") return v;
    S.del("hlm_sort");
    return "pop";
  }

  /* 順序有意義：mysubs 要先算好，pf 才有東西可以拿來當預設 */
  if (!Array.isArray(state.mysubs)) state.mysubs = [];
  state.mysubs = state.mysubs.filter(knownBrand);
  /* 從來沒手動篩過（localStorage 裡沒有 hlm_pf、或值壞掉）→ 用「我訂的平台」當預設；
     篩過就尊重他上次的選擇。這條規則寫在 CLAUDE.md 第 22 條，程式一定要跟得上。 */
  if (!Array.isArray(state.pf)) state.pf = state.mysubs.slice();
  /* 認不得的平台 key（舊版留下的、或 TMDB 那邊改名下架）直接丟掉，不要留著當地雷。
     只在記憶體裡濾掉，不寫回 localStorage。 */
  state.pf = state.pf.filter(knownBrand);
  if (!Array.isArray(state.recent)) state.recent = [];

  var listReq = 0;      /* 列表請求序號：舊的回來就丟掉 */
  var curId = null;     /* 目前詳細頁的電影 id */
  var navDepth = 0;     /* 我們自己 push 進去幾層，決定返回要不要用 history.back() */
  var toastT;

  function toast(m) {
    var t = $("toast");
    t.textContent = m; t.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("on"); }, 2400);
  }

  function pushRecent(kw) {
    kw = String(kw || "").trim();
    if (!kw) return;
    state.recent = state.recent.filter(function (x) { return x !== kw; });
    state.recent.unshift(kw);
    if (state.recent.length > 6) state.recent = state.recent.slice(0, 6);
    S.set("hlm_recent", state.recent);
  }

  function hasTmdbKey() { return !!S.keys().tmdb; }
  /* 設定頁上顯示「你貼的那把」用的遮罩（不要把整串印在畫面上） */
  function maskKey(v) {
    var t = String(v || "");
    if (!t) return "";
    return t.length <= 8 ? "••••••••" : t.slice(0, 4) + "••••••••" + t.slice(-2);
  }

  /* ---------- 首頁渲染 ---------- */
  function renderTabs() {
    var t = $("tabs").querySelectorAll(".tab");
    for (var i = 0; i < t.length; i++) {
      var on = t[i].getAttribute("data-tab") === state.tab;
      t[i].classList.toggle("on", on);
      t[i].setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function renderPf() {
    var on = state.tab === "stream" && !state.query;
    $("pfWrap").classList.toggle("hide", !on);
    if (!on) return;
    var html = '<button class="pf' + (state.pf.length ? "" : " on") + '" type="button" data-pf="__all">全部平台</button>';
    html += HLM_FILTERABLE.map(function (k) {
      var b = HLM_BRAND[k];
      return '<button class="pf' + (state.pf.indexOf(k) >= 0 ? " on" : "") + '" type="button" data-pf="' + k + '">' +
        '<span class="sq" style="background:' + b.c + '">' + b.s + "</span>" + UI.esc(b.n) + "</button>";
    }).join("");
    $("pfbar").innerHTML = html;
  }

  function renderRecent() {
    var w = $("recentWrap");
    if (state.query || !state.recent.length) { w.classList.add("hide"); return; }
    w.classList.remove("hide");
    $("recent").innerHTML = state.recent.map(function (k, i) {
      return '<button class="chip del" type="button" data-kw="' + UI.esc(k) + '">' + UI.esc(k) +
        '<span class="x" data-del="' + i + '">✕</span></button>';
    }).join("");
  }

  function renderShell() {
    $("tabs").classList.toggle("hide", !!state.query);
    renderTabs(); renderPf(); renderRecent();
  }

  /* ---------- 列表排序 ---------- */
  /* popularity 缺值或剛好相同時，一定要有固定的第二順位（這裡用 id），
     否則同一份片單每次重整順序都會跳動——他會覺得「怪怪的」但講不出哪裡怪。 */
  function byPop(x, y) {
    var d = (y.pop || 0) - (x.pop || 0);
    return d !== 0 ? d : (x.id - y.id);
  }
  function byScore(x, y) {
    var xs = x.tmdb == null ? -1 : x.tmdb, ys = y.tmdb == null ? -1 : y.tmdb;
    if (ys !== xs) return ys - xs;
    return byPop(x, y);
  }
  function sortItems(items, mode) {
    if (state.sort === "pop") {
      /* 串流的 discover 本來就帶 sort_by=popularity.desc → 直接用 API 的順序，
         不要在前端再排一次（TMDB 回的 popularity 欄位跟它自己的排序不見得完全一致）。 */
      if (mode === "stream") return items;
      return items.slice().sort(byPop);
    }
    return items.slice().sort(byScore);
  }

  function loadList(force) {
    var seq = ++listReq;
    var mode = state.query ? "search" : state.tab;
    renderShell();
    $("emptyBox").innerHTML = "";
    $("hintline").innerHTML = "";
    $("sortbtn").classList.add("hide");

    if (!hasTmdbKey()) {
      /* 拿不到金鑰＝這個 App 現在不能用。這裡是**唯一**的逃生門：
         說清楚怎麼了 ＋ 讓他自己貼金鑰。畫面由 ui.js 產生，完全不碰鑰匙圈模組。 */
      $("listTitle").textContent = "";
      $("list").innerHTML = "";
      $("sortbtn").classList.add("hide");
      var kk = S.keys();
      $("emptyBox").innerHTML = UI.keyErrorHTML(kk, krErrCtx());
      /* 逃生門也算「畫面好了」：開場要收，不可以讓他對著開場畫面等 6 秒保險絲 */
      if (!krState.loading) splashReady();
      return;
    }

    $("listTitle").textContent = mode === "search" ? "搜尋中…" : "載入中…";
    $("list").innerHTML = UI.skeletonRows(mode === "search" ? 3 : 4);

    if (force) {
      if (mode === "search") S.cacheDel("q:" + state.query.toLowerCase());
      else if (mode === "cinema") S.cacheDel("cine");
      else S.cacheDel("stream:" + (state.pf.map(function (k) { return HLM_BRAND[k] && HLM_BRAND[k].id; })
        .filter(Boolean).sort(function (a, b) { return a - b; }).join("|") || "all"));
    }

    var p;
    if (mode === "cinema") {
      p = Api.cinemaList().then(function (r) { markCinema(r.v); return r; });
    } else {
      /* 搜尋／串流的結果也要標「電影院上映中」→ 順便拿一次片單
         （6 小時快取，通常不會多打 API；抓不到就只是少一個標籤，不影響主流程） */
      p = Promise.all([
        mode === "search" ? Api.search(state.query) : Api.streamList(state.pf),
        ensureCinemaIds()
      ]).then(function (rs) { return rs[0]; });
    }

    p.then(function (r) {
      splashReady();                       /* 片單資料到了＝可以收開場了 */
      if (seq !== listReq) return;
      var items = r.v.slice();
      for (var i = 0; i < items.length; i++) items[i].inCinema = !!state.cinemaIds[items[i].id];

      /* 搜尋結果維持 TMDB 的相關度排序，不要動 */
      if (mode !== "search") items = sortItems(items, mode);

      var title, hint;
      if (mode === "search") {
        title = "搜尋結果 · " + items.length + " 部";
        hint = "列表分數是 <b>TMDB 觀眾評分</b>；點進去才會查 IMDb 與爛番茄。";
      } else if (mode === "cinema") {
        title = "現在電影院上映中 · " + items.length + " 部";
        hint = "列表分數是 <b>TMDB 觀眾評分</b>（10 分制）。IMDb、爛番茄、Metacritic 要點進片子才會去查。";
      } else {
        var names = pfNames();
        title = "訂閱就能看 · " + items.length + " 部";
        var isMine = state.mysubs.length && state.pf.length === state.mysubs.length &&
          state.pf.every(function (k) { return state.mysubs.indexOf(k) >= 0; });
        hint = (state.pf.length
          ? "目前只看" + (isMine ? "你訂的" : "") + "：<b>" + UI.esc(names.join("、")) + "</b>。"
          : "目前顯示所有平台。") +
          " 列表分數是 <b>TMDB 觀眾評分</b>；IMDb、爛番茄點進片子才會查。租借／購買的片不列在這裡。";
      }
      if (r.stale) hint += ' <span style="color:#e0a63c">（連不上網路，顯示 ' + UI.fmtTime(r.t) + " 存下來的資料）</span>";

      $("listTitle").textContent = title;
      $("hintline").innerHTML = hint;
      /* 電影院與串流都給切換鈕（搜尋結果不給，那裡照相關度排） */
      if (mode !== "search") {
        $("sortbtn").classList.remove("hide");
        $("sortbtn").textContent = state.sort === "score" ? "依評價 ▾" : "依熱門 ▾";
      }

      if (!items.length) {
        $("list").innerHTML = "";
        $("emptyBox").innerHTML = mode === "search" ? UI.emptySearch(state.query)
          : (mode === "stream" && state.pf.length) ? UI.emptyPf()
            : UI.emptyList(mode === "cinema" ? "現在查不到上映中的片" : "這裡目前沒有片",
              mode === "cinema" ? "TMDB 的台灣上映片單這時候是空的，晚點再看看。" : "TMDB 在台灣的訂閱片單目前回空的，晚點再看看。");
        return;
      }

      $("list").innerHTML = items.map(function (m) {
        return UI.rowHTML(m, mode, Api.providersCachedOnly(m.id));
      }).join("");

      /* 串流／搜尋列表的平台色塊：背景慢慢補（TMDB 呼叫、有 24 小時快取；OMDb 絕不在列表呼叫） */
      if (mode !== "cinema") fillProviders(items, seq, mode);
    }).catch(function (e) {
      splashReady();                       /* 失敗也要收開場，否則開場變成當機畫面 */
      if (seq !== listReq) return;
      $("listTitle").textContent = "";
      $("list").innerHTML = "";
      $("hintline").innerHTML = "";
      $("emptyBox").innerHTML = UI.errorBox(e);
    });
  }

  /* 平台 key 可能是舊版留下來的、或哪天 TMDB 改名下架 → 一律守衛，
     不可以讓一個認不得的 key 把整個串流分頁打成永遠轉不完的骨架 */
  function pfNames() {
    var out = [];
    for (var i = 0; i < state.pf.length; i++) {
      var b = HLM_BRAND[state.pf[i]];
      if (b) out.push(b.n);
    }
    return out;
  }

  /* 拿電影院片單只為了標「上映中」；失敗就算了 */
  function ensureCinemaIds() {
    return Api.cinemaList().then(function (r) { markCinema(r.v); return r; }).catch(function () { return null; });
  }

  function markCinema(items) {
    state.cinemaIds = {};
    for (var i = 0; i < items.length; i++) state.cinemaIds[items[i].id] = true;
  }

  function fillProviders(items, seq, mode) {
    var i = 0;
    function next() {
      if (seq !== listReq || i >= items.length) return;
      var m = items[i++];
      Api.providers(m.id).then(function (r) {
        if (seq !== listReq) return;
        var el = document.querySelector('[data-meta="' + m.id + '"]');
        if (el) el.innerHTML = UI.metaHTML(m, mode, r.v);
      }).catch(function () { }).then(next, next);
    }
    for (var c = 0; c < 3; c++) next();
  }

  /* ---------- 鑰匙圈（v1.3.0：公開模式，沒有登入畫面） ----------
     這個 App 用的是 TMDB／OMDb 的免費查詢金鑰，不是憑證，所以鑰匙圈那邊把它標成
     **公開**：值以明文放在 keyring.json 的 apps[]（public:true ＋ plain），
     不綁使用者、不需要密碼。模組拿到之後直接寫進 C.krBlobKey，我們再拆成兩把。
     → 使用者看到的是：**打開網址就能用**，沒有解鎖畫面、沒有設定金鑰那一頁。

     ⚠️ 四條界線：
     ① 鑰匙圈壞掉／沒載到／抓不到 → **一定要留一條手貼金鑰的路**（首頁的逃生門），
        而且那個畫面的產生**完全不碰模組**（ui.js 只吃布林值），
        否則模組壞掉時連錯誤畫面都出不來＝真的被鎖在門外。
     ② 手貼的金鑰**優先於**公開值（他特地貼的最大），公開值不可以蓋掉它。
     ③ 存取模組的每一個點都包 krTry（版本落差會同步擲出，見下面那段）。
     ④ 不要在我們的 CSS 裡寫任何 kr- 規則（那是跨 App 公版，模組自己帶樣式）。 */
  var krErr = null;         /* blob 格式不對時記下來，逃生門要顯示人話 */
  /* 給逃生門畫面用的狀態。**只有布林值與字串**：它會被丟給 ui.js，而 ui.js 不准碰模組。 */
  var krState = { loading: false, tried: false, why: "" };

  /* ⚠️ 存取這個模組的**每一個點**都要包起來，而且要連「讀屬性」本身一起包。
     它是跨 App 公版的複製品：**正本改了 API、我們這份沒跟上（版本落差）**，
     是共用模組最常見的退化方式，症狀是同步擲出 → 整支 app.js 停掉 → 連手貼金鑰的逃生門都不見。
     判準不是「我有沒有包 try/catch」，而是「**boot() 這條路上總共碰了模組幾次**」：
     `grep -rn "Keyring\." js/*.js` 目前是 **3 個存取點**（init／whenReady／reload），
       t13 §55 用樁把每一個各打壞四種（模組整支不見、少這個方法、方法一叫就爆、連讀屬性都爆）。
     （唯一不走 krTry 的是 Keyring.init，它的守衛是啟動那段的 try/catch——
       兩層都包的話那層就變成沒人守得住的死碼，K07 也會失去意義。） */
  function krTry(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  function krOn() {
    return krTry(function () { return !!(window.Keyring && typeof window.Keyring.init === "function"); }, false);
  }

  /* 把鑰匙圈解出來的 blob 拆成兩把金鑰。回傳金鑰有沒有變。 */
  function krApply(loud) {
    /* ⭐ 他自己貼過金鑰就到此為止：手貼的優先，鑰匙圈的公開值不可以蓋掉它。 */
    if (krTry(function () { return S.keysManual(); }, false)) return false;
    var b = null;
    try { b = S.keyringBlob(); } catch (e) { b = null; }
    if (!b) return false;
    var pair;
    try { pair = Api.parseKeyringBlob(b.raw); }
    catch (e) {
      krErr = e;
      if (loud) toast(Api.human(e).t);
      return false;
    }
    krErr = null;
    var now = S.keys();
    if (S.keysFromKeyring() && now.tmdb === pair.tmdb && now.omdb === pair.omdb) return false;
    S.saveKeysFromKeyring(pair.tmdb, pair.omdb, b.remember);
    return true;
  }

  /* ⛔ v1.3.0 起這個 App **完全沒有登入 UI**：
     不畫身分藥丸（chipHtml）、不自動彈解鎖（maybeIntro）、設定頁也沒有解鎖入口。
     公開模式本來就沒有身分可言；而在「後台還沒設成公開」的過渡期，
     使用者看到的是逃生門那句人話（去後台設公開，或自己貼金鑰），不是一個解不開的登入框。
     → 少兩個存取點 ＝ 模組壞掉時少兩條會炸的路。 */

  /* 鑰匙圈那邊有動靜（公開值到了／換了／被關掉）都走這裡 */
  function krChanged(st) {
    var had = hasTmdbKey();
    var changed = (st && st.unlocked) ? krApply(true) : S.clearKeyringKeys();
    $("gear").classList.toggle("warn", !hasTmdbKey());
    if (!changed) return;
    if (hasTmdbKey() && !had) {
      /* 從「還不能查」變成「可以查」：直接把片單補上，不要讓他自己按重試 */
      if (state.view === "setup") { showHome(false); afterSetup(); return; }
      afterSetup();
      return;
    }
    if (state.view === "setup") { renderSetup(false); return; }
    if (state.view === "home") loadList();
  }

  function setupKeyring() {
    if (!krOn()) { krState.tried = true; krState.why = "這台裝置沒有載到鑰匙圈模組（js/keyring-unlock.js）。"; return; }
    Keyring.init({
      appId: C.krAppId,          /* ASCII，跟 repo 同名（鑰匙圈的 id 鐵律） */
      appName: C.krAppName,
      tokenKey: C.krBlobKey,     /* ⚠️ 專用的新 key，不是 hlm_key_tmdb */
      toast: toast,
      onChange: krChanged
    });
    /* init() 會把**上次抓到的公開值**同步寫回 krBlobKey，所以這裡先拆一次：
       第二次之後打開就是「立刻有金鑰」，連等都不用等（順序不能反，boot() 馬上要用）。 */
    krApply(false);
    /* 第一次進站（或後台換了值）要等網路那一趟。whenReady 不管成功失敗都會回來。 */
    krState.loading = !hasTmdbKey();
    var done = function () {
      krState.loading = false;
      krState.tried = true;
      krApply(false);
      if (!hasTmdbKey()) {
        krState.why = krErr
          ? Api.human(krErr).t + "：" + Api.human(krErr).b
          : "鑰匙圈上找不到這個 App 的公開金鑰（後台可能還沒把它設成公開），或是現在連不上網路。";
      }
      $("gear").classList.toggle("warn", !hasTmdbKey());
      if (state.view === "home") { if (hasTmdbKey()) afterSetup(); else loadList(); }
    };
    var p = krTry(function () { return Keyring.whenReady(); }, null);
    if (p && typeof p.then === "function") p.then(done, done); else done();
  }

  /* 逃生門畫面要的東西。⚠️ 只有布林值與字串，ui.js 不會、也不准去問模組任何事。 */
  function krErrCtx() {
    return {
      loading: !!krState.loading,
      why: krState.why,
      hasModule: krOn(),
      lsBroken: !S.lsOK
    };
  }

  /* ---------- PTT 鄉民風向 ----------
     整份 JSON 一次抓、一個 session 只抓一次（Api.ptt 自己記住結果）。
     這裡只放「畫面現在該顯示哪一種狀態」，資料與快取邏輯在 api.js。 */
  var ptt = { loading: false, data: null, err: null, open: false };
  var pttRepaint = null;      /* 由 openDetail 設定：只重畫 PTT 那張卡，不要重畫整頁
                                 （重畫整頁會把他展開的劇情簡介收回去） */

  function loadPtt(force) {
    if (ptt.loading) return;
    if (ptt.data && !force) return;
    ptt.loading = true; ptt.err = null;
    if (pttRepaint) pttRepaint();
    Api.ptt(force).then(function (r) {
      ptt.loading = false; ptt.data = r.v; ptt.err = null;
      if (pttRepaint) pttRepaint();
    }).catch(function (e) {
      /* 讀不到 ≠ 沒有討論。這裡一定要留下 err，畫面才會走「讀取失敗＋重試」而不是空狀態 */
      ptt.loading = false; ptt.err = e;
      if (pttRepaint) pttRepaint();
    });
  }

  /* ---------- 詳細頁 ---------- */
  function backLabel() {
    if (state.query) return "回搜尋結果";
    return state.tab === "cinema" ? "回電影院片單" : "回串流片單";
  }

  function openDetail(id, force) {
    curId = id;
    state.view = "detail";
    $("view-home").style.display = "none";
    $("view-setup").classList.remove("on");
    $("view-detail").classList.add("on");
    $("dtop").classList.remove("stuck");
    $("backlabel").textContent = backLabel();
    window.scrollTo(0, 0);

    if (force) {
      S.cacheDel("m:" + id);
      S.cacheDel("pv:" + id);
      /* OMDb 的分數也要清（見 loadScores）。刻意不在這裡用舊快取去找 imdb id——
         舊的 m: 可能已經被 sweep() 淘汰掉，那樣就永遠清不到 o:。 */
    }

    ptt.open = false;                     /* 切到別部片就收合（規格 §9.5） */
    var ctx = { ready: false, pvLoading: true, scores: null, pv: null, backLabel: backLabel(), ovOpen: false, ptt: ptt };
    var mv = null, stamps = [];

    /* 只重畫 PTT 那張卡（重畫整頁會把他展開的劇情簡介收回去）。
       ⚠️ 層 B 的備援守衛：pttRepaint 每次 openDetail 都會被覆寫成「最新那部片」的，
       所以 curId !== id 目前**觸發不到**（跟 CLAUDE.md 第 16 條的 pfNames 同一種東西）。
       留著是為了以後有人改成「不只一個地方會觸發重畫」時，
       不會把上一部片的 PTT 資料畫進新片的卡。真正在守這件事的是
       「一律用當下的 pttRepaint」這個設計本身，t12 §45 驗的是那個行為。 */
    pttRepaint = function () {
      if (curId !== id) return;
      var el = $("pttcard");
      if (el) el.innerHTML = UI.pttHTML(id, ptt);
    };
    loadPtt(false);

    function paint() {
      if (curId !== id) return;
      ctx.stamp = stamps.length ? Math.min.apply(null, stamps) : 0;
      $("dtitle").textContent = mv.zh;
      $("dbody").innerHTML = UI.detailHTML(mv, ctx);
      var ov = $("ov"), ovb = $("ovbtn");
      if (ovb && ov) {
        if (ctx.ovOpen) { ov.classList.remove("clamp"); ovb.textContent = "收合"; }
        else if (ov.scrollHeight <= ov.clientHeight + 2) ovb.classList.add("hide");
      }
    }

    /* 快取全中就直接畫完整的，不要假裝載入 */
    var mHit = force ? null : S.cacheGet("m:" + id, C.ttl.movie);
    if (mHit) {
      mv = mHit.v; stamps.push(mHit.t);
      mv.inCinema = !!state.cinemaIds[id];
      var pvHit = S.cacheGet("pv:" + id, C.ttl.providers);
      if (pvHit) { ctx.pv = pvHit.v; ctx.pvLoading = false; stamps.push(pvHit.t); }
      var oHit = mv.imdb ? S.cacheGet("o:" + mv.imdb, C.ttl.omdb) : null;
      if (oHit) { ctx.scores = oHit.v; ctx.ready = true; stamps.push(oHit.t); }
      else if (!S.keys().omdb) { ctx.ready = true; ctx.scoreErr = "nokey"; }
      paint();
      splashReady();          /* 直接用網址開某部片時，這一頁畫完就可以收開場 */
      if (!pvHit) loadPv();
      if (!oHit && S.keys().omdb) loadScores();
      return;
    }

    $("dtitle").textContent = "";
    $("dbody").innerHTML = UI.detailSkeleton();

    /* 直接用網址開某部片時還沒有片單，補抓一次才知道它在不在戲院 */
    var needCine = true;
    for (var _k in state.cinemaIds) { needCine = false; break; }

    Api.movie(id).then(function (r) {
      splashReady();
      if (curId !== id) return;
      mv = r.v; stamps.push(r.t);
      mv.inCinema = !!state.cinemaIds[id];
      if (r.stale) ctx.stale = true;
      if (!S.keys().omdb) { ctx.ready = true; ctx.scoreErr = "nokey"; }
      paint();
      loadPv();
      if (S.keys().omdb) loadScores();
      if (needCine) ensureCinemaIds().then(function () {
        if (curId !== id || !mv) return;
        if (state.cinemaIds[id]) { mv.inCinema = true; paint(); }
      });
    }).catch(function (e) {
      splashReady();
      if (curId !== id) return;
      $("dbody").innerHTML = '<div style="padding:16px">' + UI.errorBox(e) +
        '</div><div class="backbar"><button type="button" id="back2">' + UI.esc(backLabel()) + "</button></div>";
    });

    function loadPv() {
      Api.providers(id).then(function (r) {
        if (curId !== id) return;
        ctx.pv = r.v; ctx.pvLoading = false; stamps.push(r.t); paint();
      }).catch(function () {
        if (curId !== id) return;
        ctx.pvLoading = false; paint();
      });
    }

    function loadScores() {
      if (!mv || !mv.imdb) { ctx.ready = true; ctx.scoreErr = "notfound"; paint(); return; }
      /* 按鈕文案承諾「重新抓一次」，就要真的連 OMDb 分數一起重抓（PM 拍板：手動觸發、
         頻率極低，額度影響可忽略）。用剛抓回來的 imdb id，不依賴任何舊快取。 */
      if (force) S.cacheDel("o:" + mv.imdb);
      Api.scores(mv.imdb).then(function (r) {
        if (curId !== id) return;
        ctx.scores = r.v; ctx.ready = true; stamps.push(r.t); paint();
      }).catch(function (e) {
        if (curId !== id) return;
        /* OMDb 查不到是常態（台片／新片／冷門片）→ 安靜降級成「查無收錄」，不跳錯誤 */
        ctx.ready = true; ctx.scoreErr = e.kind || "unknown"; paint();
      });
    }
  }

  /* ---------- 設定頁 ---------- */
  function renderSetup(firstRun) {
    state.view = "setup";
    $("view-home").style.display = "none";
    $("view-detail").classList.remove("on");
    $("view-setup").classList.add("on");
    $("stop").classList.add("stuck");
    window.scrollTo(0, 0);
    var k = S.keys();
    k.mysubs = state.mysubs;
    /* 設定頁不再有手貼表單；只在他真的手貼過時顯示一行狀態＋清掉（見 ui.setupHTML）。
       ⚠️ 這裡照樣只丟布林值與字串給 ui.js。 */
    k.manual = krTry(function () { return S.keysManual(); }, false);
    k.tmdbMask = maskKey(k.tmdb);
    k.omdbMask = maskKey(k.omdb);
    $("sbody").innerHTML = UI.setupHTML(k, firstRun);
    splashReady();          /* 直接用 #/setup 開 App 時，這一頁畫完就可以收開場 */
    var st = S.cacheStats();
    $("cachestat").textContent = "目前存了 " + st.n + " 筆資料（約 " + st.kb + " KB）。清掉之後下次會重新跟 TMDB 要，額度也會多用一點。";
    if (!S.lsOK) {
      $("sbody").insertAdjacentHTML("afterbegin",
        '<div style="padding:0 16px"><div class="errbox hard"><h3>這個瀏覽器不讓我存資料</h3>' +
        "<p>可能是無痕模式或隱私設定。金鑰跟快取只會活到這個分頁關掉為止，每次開都要重貼。用一般（非無痕）視窗開就好。</p></div></div>");
    }
  }

  function runTests() {
    var k = { tmdb: $("ktmdb").value.trim(), omdb: $("komdb").value.trim() };
    S.saveKeys(k.tmdb, k.omdb);
    var out = $("testout");
    out.innerHTML = UI.testRow(null, "TMDB", "測試中…") + UI.testRow(null, "OMDb", "測試中…");
    var res = { tmdb: null, omdb: null }, done = { tmdb: false, omdb: false };
    function draw() {
      out.innerHTML =
        (done.tmdb ? UI.testRow(res.tmdb.ok, "TMDB", res.tmdb.msg) : UI.testRow(null, "TMDB", "測試中…")) +
        (done.omdb ? UI.testRow(res.omdb.ok, "OMDb", res.omdb.msg) : UI.testRow(null, "OMDb", "測試中…"));
      if (done.tmdb && done.omdb) {
        if (res.tmdb.ok) {
          out.insertAdjacentHTML("beforeend",
            '<div class="acts" style="margin-top:12px"><button class="btn pri wide" type="button" data-act="home">開始查片</button></div>');
        }
        $("gear").classList.toggle("warn", !res.tmdb.ok);
      }
    }
    Api.testTmdb(k.tmdb).then(function (r) { res.tmdb = r; done.tmdb = true; draw(); });
    Api.testOmdb(k.omdb).then(function (r) { res.omdb = r; done.omdb = true; draw(); });
  }

  /* ---------- 視圖切換 / 路由 ---------- */
  function showHome(restoreScroll) {
    var was = state.view;
    state.view = "home";
    curId = null;
    $("view-detail").classList.remove("on");
    $("view-setup").classList.remove("on");
    $("view-home").style.display = "block";
    $("gear").classList.toggle("warn", !hasTmdbKey());
    /* 返回（pop）：首頁從**左邊**回來，跟進詳細頁的方向相反 —— 那是使用者的方向感。
       只有真的從詳細頁／設定頁退回來才播；開機那次不播（開場的 .boot 已經在演了）。
       重播動畫的正規做法：拿掉 class → 讀一次 offsetWidth 強制回流 → 再加回去。
       動畫是 backwards fill，跑完不留 transform，所以不用計時器收尾，
       也不會把首頁上那些按鈕的 :active 壓掉。 */
    if (was === "detail" || was === "setup") {
      var vh = $("view-home");
      vh.classList.remove("pop");
      void vh.offsetWidth;
      vh.classList.add("pop");
    }
    window.scrollTo(0, restoreScroll ? (state.homeScroll || 0) : 0);
  }

  function navTo(hash, fn) {
    try { history.pushState({ h: hash }, "", hash); navDepth++; } catch (e) { }
    fn();
  }

  function navBack() {
    if (navDepth > 0) { history.back(); return; }   /* popstate 會處理畫面 */
    try { history.replaceState({ h: "#/" }, "", "#/"); } catch (e) { }
    showHome(true);
  }

  function applyHash() {
    var h = location.hash || "";
    var m = /^#\/m\/(\d+)/.exec(h);
    if (m) { openDetail(parseInt(m[1], 10)); return; }
    if (h.indexOf("#/setup") === 0) { renderSetup(!hasTmdbKey()); return; }
    showHome(true);
  }

  window.addEventListener("popstate", function () {
    var was = state.view;
    if (navDepth > 0) navDepth--;
    applyHash();
    /* 用瀏覽器／側滑手勢離開設定頁時，也要重載片單（金鑰可能剛填好） */
    if (was === "setup" && state.view === "home") afterSetup();
  });

  /* ---------- 事件 ---------- */
  var q = $("q");

  $("sform").addEventListener("submit", function (e) {
    e.preventDefault();
    var kw = q.value.trim();
    q.blur();
    if (!kw) { if (state.query) { state.query = ""; loadList(); } return; }
    state.query = kw;
    pushRecent(kw);
    window.scrollTo(0, 0);
    loadList();
  });

  q.addEventListener("input", function () {
    $("clr").classList.toggle("hide", !q.value);
  });

  $("clr").addEventListener("click", function () {
    q.value = "";
    $("clr").classList.add("hide");
    if (state.query) { state.query = ""; window.scrollTo(0, 0); loadList(); }
    q.focus();
  });

  $("sortbtn").addEventListener("click", function () {
    state.sort = state.sort === "score" ? "pop" : "score";
    S.set("hlm_sort2", state.sort);
    loadList();
    toast(state.sort === "score" ? "改成依評價排序" : "改成依熱門排序");
  });

  $("gear").addEventListener("click", function () {
    state.homeScroll = window.scrollY;
    navTo("#/setup", function () { renderSetup(!hasTmdbKey()); });
  });

  $("back").addEventListener("click", navBack);
  $("sback").addEventListener("click", function () {
    /* 從設定頁回首頁時一定重載列表（金鑰可能剛剛才填好） */
    navBack();
    afterSetup();
  });

  /* 剛設定完金鑰：先把 provider id 校正做掉，再拉片單 */
  function afterSetup() {
    if (!hasTmdbKey()) { loadList(); return; }
    Api.syncProviderIds().then(function () { loadList(); });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var el;

    if ((el = t.closest("[data-tab]"))) {
      state.tab = el.getAttribute("data-tab");
      S.set("hlm_tab", state.tab);
      window.scrollTo(0, 0);
      loadList();
      return;
    }
    if ((el = t.closest("[data-pf]"))) {
      var k = el.getAttribute("data-pf");
      if (k === "__all") state.pf = [];
      else {
        var i = state.pf.indexOf(k);
        if (i >= 0) state.pf.splice(i, 1); else state.pf.push(k);
      }
      S.set("hlm_pf", state.pf);
      state.tab = "stream"; S.set("hlm_tab", "stream");
      loadList();
      return;
    }
    if ((el = t.closest("[data-del]"))) {
      e.stopPropagation();
      state.recent.splice(parseInt(el.getAttribute("data-del"), 10), 1);
      S.set("hlm_recent", state.recent);
      renderRecent();
      return;
    }
    if ((el = t.closest("[data-kw]"))) {
      var kw = el.getAttribute("data-kw");
      q.value = kw; $("clr").classList.remove("hide");
      state.query = kw; pushRecent(kw);
      window.scrollTo(0, 0);
      loadList();
      return;
    }
    if ((el = t.closest("[data-open]"))) {
      var id = parseInt(el.getAttribute("data-open"), 10);
      var titleEl = el.querySelector(".rowtitle");
      if (titleEl) pushRecent(titleEl.textContent);
      state.homeScroll = window.scrollY;
      navTo("#/m/" + id, function () { openDetail(id); });
      return;
    }
    if ((el = t.closest("[data-act]"))) {
      var a = el.getAttribute("data-act");
      if (a === "setup") { state.homeScroll = window.scrollY; navTo("#/setup", function () { renderSetup(!hasTmdbKey()); }); }
      else if (a === "retry") {
        /* 詳細頁上的重試要重抓那部片，不是重抓片單 */
        if (state.view === "detail" && curId) openDetail(curId, true); else loadList(true);
      }
      else if (a === "home") {
        /* 逃生門就在首頁上，這時候沒有「上一頁」可以退——直接把片單補上就好 */
        if (state.view !== "home") navBack();
        afterSetup();
      }
      return;
    }
    if (t.closest("#back2")) { navBack(); return; }
    if (t.closest("#refresh")) {
      if (curId) { toast("重新抓一次…"); openDetail(curId, true); }
      return;
    }
    if ((el = t.closest("[data-sub]"))) {
      var sk = el.getAttribute("data-sub");
      var si = state.mysubs.indexOf(sk);
      if (si >= 0) state.mysubs.splice(si, 1); else state.mysubs.push(sk);
      S.set("hlm_mysubs", state.mysubs);
      /* 勾了就立刻套用到串流分頁的篩選，不然他要回片單再點一次才會生效 */
      state.pf = state.mysubs.slice();
      S.set("hlm_pf", state.pf);
      $("mysubs").innerHTML = UI.mysubsChips(state.mysubs);
      return;
    }
    if (t.closest("#doupdate")) { location.reload(); return; }
    if (t.closest("#dismissupdate")) { $("updatebar").classList.add("hide"); return; }
    if (t.closest("#saveTest")) { runTests(); return; }
    if (t.closest("#justSave")) {
      S.saveKeys($("ktmdb").value.trim(), $("komdb").value.trim());
      $("gear").classList.toggle("warn", !hasTmdbKey());
      toast("金鑰已存在這台裝置");
      /* 逃生門在首頁上：存完就直接把片單補上，不要讓他自己想辦法離開這個畫面 */
      if (state.view === "home" && hasTmdbKey()) afterSetup();
      return;
    }
    if (t.closest("#krretry")) {
      krState.loading = true; krState.why = "";
      loadList();
      krTry(function () { return Keyring.reload(); }, null);
      var again = function () { krState.loading = false; krState.tried = true; krApply(false);
        if (hasTmdbKey()) { toast("拿到金鑰了"); afterSetup(); } else {
          krState.why = "還是拿不到。可能是鑰匙圈那邊還沒把這個 App 設成公開，或是現在連不上網路。";
          loadList();
        } };
      var pr = krTry(function () { return Keyring.whenReady(); }, null);
      if (pr && typeof pr.then === "function") setTimeout(function () { pr.then(again, again); }, 250);
      else setTimeout(again, 250);
      return;
    }
    if (t.closest("#mkclear")) {
      S.saveKeys("", "");
      S.del("hlm_keys_src");
      krApply(false);
      renderSetup(false);
      $("gear").classList.toggle("warn", !hasTmdbKey());
      toast(hasTmdbKey() ? "清掉了，改用鑰匙圈的金鑰" : "清掉了");
      return;
    }
    if (t.closest("#clearCache")) {
      S.cacheClear();
      renderSetup(!hasTmdbKey());
      toast("快取已清空");
      return;
    }
    if (t.closest("#pttmore")) {
      ptt.open = !ptt.open;
      if (pttRepaint) pttRepaint();
      return;
    }
    if (t.closest("#pttretry")) {
      loadPtt(true);
      return;
    }
    if ((el = t.closest("#ovbtn"))) {
      var ov = $("ov");
      var on = ov.classList.toggle("clamp");
      el.textContent = on ? "展開全部" : "收合";
      return;
    }
  });

  window.addEventListener("scroll", function () {
    if (state.view === "detail") $("dtop").classList.toggle("stuck", window.scrollY > 72);
  }, { passive: true });

  /* ---------- 啟動：開機就自我體檢，不等他搜尋才報錯 ---------- */
  function boot() {
    S.sweep();
    renderShell();
    $("gear").classList.toggle("warn", !hasTmdbKey());

    /* v1.3.0：**不再有「第一次使用要設定金鑰」那一頁**。
       金鑰是鑰匙圈的公開值自動帶進來的，所以一律直接進片單；
       真的拿不到金鑰時，片單區會出現「現在還不能查片」＋手貼逃生門（loadList 那條）。 */
    if (!hasTmdbKey()) {
      showHome(false);
      loadList();
      return;
    }
    /* provider id 校正（1 次呼叫、快取 30 天）先做完再拉片單，
       不然串流分頁第一次可能用到過時的 provider id */
    Api.syncProviderIds().then(function () {
      if (location.hash && location.hash !== "#/" && location.hash !== "#/setup") { applyHash(); return; }
      showHome(false);
      loadList();
    });
  }

  /* Service Worker：相對路徑（GitHub Pages 專案站在子路徑底下）
     ⚠️ 三件事不可以改掉（理由見 CLAUDE.md）：
     ① 第一次安裝時 clients.claim() 也會觸發 controllerchange，那時候不可以 reload——
        他第一次進來看到的就是設定頁，正在貼 32 碼金鑰，reload 會把他打的字全部吃掉。
     ② 偵測到新版**不自動 reload**，只跳提示、由他自己按。
     ③ 整段包 try/catch、而且擺在 boot() 之後：有些瀏覽器（私密視窗、App 內建瀏覽器）
        `"serviceWorker" in navigator` 是 true 但值是 undefined，一 throw 就會把整支 app.js
        停在 boot() 之前——畫面看起來是活的（骨架都在）但什麼都不能按，比白畫面更難查。 */
  function setupSW() {
    try {
      var sw = navigator.serviceWorker;
      if (!sw || typeof sw.register !== "function") return;
      var hadController = !!sw.controller;       /* 進站當下就要記 */
      window.addEventListener("load", function () {
        try {
          sw.register("./sw.js", { scope: "./" }).catch(function () { });
          sw.addEventListener("controllerchange", function () {
            if (!hadController) return;          /* 第一次安裝，不是更新 */
            $("updatebar").classList.remove("hide");
          });
        } catch (e) { /* 註冊失敗頂多就是沒有離線與更新提示，App 照常用 */ }
      });
    } catch (e) { }
  }

  /* 順序有意義：
     ① 鑰匙圈先跑——它會把金鑰塞回 localStorage，boot() 的自我體檢才不會誤判成「還沒設定」。
        包 try/catch：鑰匙圈壞掉頂多回到「自己貼金鑰」那條路，不可以讓 App 打不開。
     ② boot()。
     ③ SW 最後（見上面第 ③ 點）：App 能不能用，永遠優先於 PWA 的加值功能。 */
  try { setupKeyring(); } catch (e) { }
  boot();
  setupSW();
})();

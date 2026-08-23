/* 好雷嗎? — 主控（狀態、路由、事件）
   資料流鐵律：中文片名 → TMDB 拿 tmdb_id / imdb_id → 用 imdb_id 打 OMDb 拿三個分數。
   詳細頁一定是漸進顯示：TMDB 先畫，OMDb 用骨架佔位、到了再補。不可以改成「等齊再顯示」。 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var UI = HLM_UI, Api = HLM_Api, S = HLM_Store, C = HLM_CFG;

  /* ---------- 狀態 ---------- */
  var state = {
    tab: S.get("hlm_tab", "cinema") === "stream" ? "stream" : "cinema",
    sort: S.get("hlm_sort", "score") === "pop" ? "pop" : "score",
    pf: S.get("hlm_pf", null),
    mysubs: S.get("hlm_mysubs", []) || [],
    recent: S.get("hlm_recent", []) || [],
    query: "",
    homeScroll: 0,
    view: "home",
    cinemaIds: {}
  };
  function knownBrand(k) { return !!HLM_BRAND[k]; }

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

  /* ---------- 列表 ---------- */
  function sortCinema(a) {
    return a.slice().sort(function (x, y) {
      if (state.sort === "pop") return (y.pop || 0) - (x.pop || 0);
      var xs = x.tmdb == null ? -1 : x.tmdb, ys = y.tmdb == null ? -1 : y.tmdb;
      if (ys !== xs) return ys - xs;
      return (y.pop || 0) - (x.pop || 0);
    });
  }

  function loadList(force) {
    var seq = ++listReq;
    var mode = state.query ? "search" : state.tab;
    renderShell();
    $("emptyBox").innerHTML = "";
    $("hintline").innerHTML = "";
    $("sortbtn").classList.add("hide");

    if (!hasTmdbKey()) {
      $("listTitle").textContent = "";
      $("list").innerHTML = "";
      $("emptyBox").innerHTML = UI.errorBox(Api.err("nokey", "tmdb"));
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
      if (seq !== listReq) return;
      var items = r.v.slice();
      for (var i = 0; i < items.length; i++) items[i].inCinema = !!state.cinemaIds[items[i].id];

      if (mode === "cinema") items = sortCinema(items);
      else if (mode === "stream") items.sort(function (x, y) { return (y.tmdb || 0) - (x.tmdb || 0); });

      var title, hint;
      if (mode === "search") {
        title = "搜尋結果 · " + items.length + " 部";
        hint = "列表分數是 <b>TMDB 觀眾評分</b>；點進去才會查 IMDb 與爛番茄。";
      } else if (mode === "cinema") {
        title = "現在電影院上映中 · " + items.length + " 部";
        hint = "列表分數是 <b>TMDB 觀眾評分</b>（10 分制）。IMDb、爛番茄、Metacritic 要點進片子才會去查。";
        $("sortbtn").classList.remove("hide");
        $("sortbtn").textContent = state.sort === "score" ? "依評價 ▾" : "依熱門 ▾";
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

    var ctx = { ready: false, pvLoading: true, scores: null, pv: null, backLabel: backLabel(), ovOpen: false };
    var mv = null, stamps = [];

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
    $("sbody").innerHTML = UI.setupHTML(k, firstRun);
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
    state.view = "home";
    curId = null;
    $("view-detail").classList.remove("on");
    $("view-setup").classList.remove("on");
    $("view-home").style.display = "block";
    $("gear").classList.toggle("warn", !hasTmdbKey());
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
    S.set("hlm_sort", state.sort);
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
      else if (a === "home") { navBack(); afterSetup(); }
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
      return;
    }
    if (t.closest("#clearCache")) {
      S.cacheClear();
      renderSetup(!hasTmdbKey());
      toast("快取已清空");
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

    if (!hasTmdbKey()) {
      try { history.replaceState({ h: "#/setup" }, "", "#/setup"); } catch (e) { }
      renderSetup(true);
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

  /* boot() 先跑：App 能不能用，永遠優先於 PWA 的加值功能 */
  boot();
  setupSW();
})();

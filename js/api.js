/* 好雷嗎? — API 層（TMDB 主、OMDb 副）
   規則（不可違反，理由見 CLAUDE.md）：
   - OMDb 只在詳細頁呼叫，列表頁一律不呼叫（免費額度 1000/天，列表一頁 20 部會燒光）
   - OMDb 查不到是常態（台片／新片／冷門片），要安靜降級成「查無收錄」，不可以跳錯誤
   - 所有錯誤要分類成：沒金鑰／金鑰錯／額度用完／沒網路／逾時／伺服器掛掉，不可以全部叫「發生錯誤」 */
var HLM_Api = (function () {
  "use strict";

  var C = HLM_CFG;

  function err(kind, src, detail) {
    var e = new Error(kind + (detail ? ": " + detail : ""));
    e.kind = kind; e.src = src || ""; e.detail = detail || "";
    return e;
  }

  /* ---------- 底層 ---------- */
  function fetchJSON(url, src) {
    var ctl = null, timer = null;
    try { ctl = new AbortController(); } catch (e) { }
    var opt = { cache: "no-store" };
    if (ctl) {
      opt.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) { } }, C.timeoutMs);
    }
    return fetch(url, opt).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (txt) {
        var json = null;
        try { json = JSON.parse(txt); } catch (e) { }
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw err("badkey", src);
          if (res.status === 429) throw err("quota", src);
          if (res.status === 404) throw err("notfound", src);
          if (res.status >= 500) throw err("server", src, String(res.status));
          /* OMDb 金鑰錯時也可能回 4xx + JSON 說明 */
          if (json && json.Error) throw err(omdbKind(json.Error), src, json.Error);
          throw err("unknown", src, String(res.status));
        }
        if (json == null) throw err("unknown", src, "回應不是 JSON");
        return json;
      });
    }).catch(function (e) {
      /* 一律用 .catch：成功處理函式裡丟出的錯（例如上面那些 throw err(...)）也要被接到，
         用 .then(成功, 失敗) 的話那些 throw 會變成沒人接的 rejection。 */
      if (timer) clearTimeout(timer);
      if (e && e.kind) throw e;
      if (e && (e.name === "AbortError")) throw err("timeout", src);
      throw err("offline", src, e && e.message);
    });
  }

  function omdbKind(msg) {
    var m = String(msg || "").toLowerCase();
    if (m.indexOf("invalid api key") >= 0 || m.indexOf("no api key") >= 0) return "badkey";
    if (m.indexOf("limit reached") >= 0) return "quota";
    if (m.indexOf("not found") >= 0 || m.indexOf("incorrect imdb") >= 0) return "notfound";
    return "unknown";
  }

  function qs(o) {
    var a = [];
    for (var k in o) {
      if (o[k] === undefined || o[k] === null || o[k] === "") continue;
      a.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
    }
    return a.join("&");
  }

  function tmdb(path, params) {
    var k = HLM_Store.keys().tmdb;
    if (!k) return Promise.reject(err("nokey", "tmdb"));
    var p = params || {};
    p.api_key = k;
    return fetchJSON(C.tmdbBase + path + "?" + qs(p), "tmdb");
  }

  function omdb(imdbId) {
    var k = HLM_Store.keys().omdb;
    if (!k) return Promise.reject(err("nokey", "omdb"));
    return fetchJSON(C.omdbBase + "?" + qs({ apikey: k, i: imdbId, r: "json" }), "omdb")
      .then(function (j) {
        if (j && String(j.Response) === "False") throw err(omdbKind(j.Error), "omdb", j.Error);
        return j;
      });
  }

  /* ---------- PTT 鄉民風向 ----------
     同源靜態 JSON，一次抓整份、**一個 session 只抓一次**（不要每點一部片抓一次）。
     ⚠️ network-first：拿得到網路就用網路的，拿不到才吃 localStorage 的離線副本。
        （不可以反過來——這個檔一天更新一次，先吃快取會讓他看到昨天的風向。）
     ⚠️ 「資料過不過期」是用 JSON 裡的 updated 判斷，不是用抓取時間：
        爬蟲掛掉時 fetch 會成功、但 updated 是舊的，那正是要抓出來的狀況。 */
  var pttMemo = null;      /* 這個 session 的結果（含失敗），避免每點一部片都打一次 */

  function ptt(force) {
    if (pttMemo && !force) return pttMemo;
    pttMemo = fetchJSON(C.pttUrl, "ptt").then(function (j) {
      if (!j || typeof j !== "object" || !j.movies) throw err("server", "ptt", "JSON 格式不對");
      /* 存成跟快取層一樣的 {t, v} 形狀；t 只是給人除錯用（「這份副本什麼時候抓的」），
         **程式沒有任何地方讀它**——資料新不新一律看 JSON 裡的 updated，不是抓取時間。 */
      HLM_Store.set("hlm_ptt", { t: Date.now(), v: j });
      return { v: j, cached: false };
    }).catch(function (e) {
      /* 網路失敗才吃離線副本。副本比 TTL 舊也照用——顯示出來的「更新於」是 JSON 自己的
         updated，不會騙人；有東西看永遠比一片空白好。 */
      var c = HLM_Store.get("hlm_ptt", null);
      if (c && c.v && c.v.movies) return { v: c.v, cached: true };
      pttMemo = null;          /* 沒有副本可用 → 讓「重試」鈕真的能重試 */
      throw e;
    });
    return pttMemo;
  }

  /* 這部片的 PTT 資料；沒有討論就回 null（跟「讀不到」是兩件事，不可以混在一起） */
  function pttFor(data, id) {
    if (!data || !data.movies) return null;
    var d = data.movies[String(id)];
    if (!d || typeof d !== "object") return null;
    return {
      good: Number(d.good) || 0, ok: Number(d.ok) || 0, bad: Number(d.bad) || 0,
      posts: Array.isArray(d.posts) ? d.posts.filter(function (p) { return p && p.url && p.title; }) : []
    };
  }

  /* ---------- 錯誤 → 人話 ---------- */
  function human(e) {
    var kind = (e && e.kind) || "unknown";
    var src = (e && e.src) === "omdb" ? "OMDb" : "TMDB";
    var map = {
      nokey: {
        t: "還沒設定 API 金鑰",
        b: "這個 App 要用你自己的 " + src + " 金鑰才能查資料。金鑰只會存在這支手機上。",
        a: "setup", al: "去設定金鑰"
      },
      badkey: {
        t: src + " 金鑰無效",
        b: src === "OMDb"
          ? "金鑰打錯，或是 OMDb 寄給你的那封啟用信還沒點。去信箱找 OMDb 的信、點裡面的連結啟用後再試。"
          : "金鑰打錯或已被撤銷。到設定頁重新貼一次，貼完按「測試連線」確認。",
        a: "setup", al: "去設定頁檢查"
      },
      quota: {
        t: src === "OMDb" ? "OMDb 今天的額度用完了" : "TMDB 請求太密集了",
        b: src === "OMDb"
          ? "OMDb 免費版一天 1000 次。IMDb／爛番茄／Metacritic 分數今天查不到了，明天會自動恢復；TMDB 的資料還是正常。"
          : "短時間內問太多次，被 TMDB 暫時擋下。等十幾秒再試就好，額度沒有被扣。",
        a: "retry", al: "重試"
      },
      offline: {
        t: "連不上網路",
        b: "看起來手機目前沒有網路，或是被防火牆／VPN 擋住。檢查連線後再試一次。",
        a: "retry", al: "重試"
      },
      timeout: {
        t: "連線逾時",
        b: src + " 太久沒有回應（超過 " + Math.round(C.timeoutMs / 1000) + " 秒）。可能是網路很慢，重試看看。",
        a: "retry", al: "重試"
      },
      server: {
        t: src + " 伺服器出問題",
        b: "不是你的問題，是 " + src + " 那邊暫時掛了（" + (e.detail || "5xx") + "）。等幾分鐘再試。",
        a: "retry", al: "重試"
      },
      notfound: {
        t: "查無這筆資料",
        b: src + " 沒有收錄這部片。",
        a: "retry", al: "重試"
      },
      unknown: {
        t: "發生未預期的問題",
        b: (src + " 回應了看不懂的內容" + (e && e.detail ? "（" + e.detail + "）" : "") + "。重試看看，一直失敗的話到設定頁確認金鑰。"),
        a: "retry", al: "重試"
      }
    };
    return map[kind] || map.unknown;
  }

  /* ---------- 正規化 ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function normItem(x) {
    var date = x.release_date || "";
    var votes = x.vote_count || 0;
    return {
      id: x.id,
      zh: x.title || x.original_title || "（無片名）",
      en: x.original_title || "",
      date: date,
      year: date ? date.slice(0, 4) : "",
      tmdb: votes > 0 && x.vote_average > 0 ? Math.round(x.vote_average * 10) / 10 : null,
      votes: votes,
      poster: x.poster_path || null,
      pop: x.popularity || 0,
      upcoming: !!(date && date > today())
    };
  }

  function normList(j) {
    var arr = (j && j.results) || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id) out.push(normItem(arr[i]));
    }
    return out;
  }

  function normDetail(j) {
    var m = normItem(j);
    m.runtime = j.runtime || null;
    m.genres = (j.genres || []).map(function (g) { return g.name; });
    m.overview = j.overview || "";
    m.imdb = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || null;
    var cr = j.credits || {};
    m.director = ((cr.crew || []).filter(function (c) { return c.job === "Director"; })
      .map(function (c) { return c.name; }).slice(0, 2)).join("、");
    m.cast = (cr.cast || []).slice(0, 4).map(function (c) { return c.name; });
    m.status = j.status || "";
    return m;
  }

  /* 用平台名字找品牌：一律取「命中的關鍵字最長」的那個，不可以先命中先贏。
     否則 "Apple TV Plus" 會被 apple 的 "apple tv" 先咬走 —— Apple TV+（訂閱）
     就變成 Apple TV（租買商店）。物件的鍵順序不該決定比對結果。 */
  function brandKeyByName(name) {
    var nm = String(name || "").toLowerCase();
    var best = null, bestLen = 0;
    for (var k in HLM_BRAND) {
      var ms = HLM_BRAND[k].match;
      for (var i = 0; i < ms.length; i++) {
        if (nm.indexOf(ms[i]) >= 0 && ms[i].length > bestLen) { best = k; bestLen = ms[i].length; }
      }
    }
    return best;
  }

  /* TMDB 的 provider 物件 → 我們的顯示格式 */
  function normProvider(p) {
    var key = null;
    for (var k in HLM_BRAND) {
      if (HLM_BRAND[k].id === p.provider_id) { key = k; break; }
    }
    if (!key) key = brandKeyByName(p.provider_name);
    if (key) {
      return { key: key, n: HLM_BRAND[key].n, c: HLM_BRAND[key].c, s: HLM_BRAND[key].s, logo: p.logo_path || null };
    }
    /* 不在字典裡的平台（LINE TV、Hami Video、KKTV…）：用 TMDB 的官方 logo，避免亂配色 */
    return { key: "p" + p.provider_id, n: p.provider_name || "其他平台", c: "#3a4152", s: "", logo: p.logo_path || null };
  }

  function normProviders(j) {
    var tw = (j && j.results && j.results.TW) || null;
    var out = { flatrate: [], rent: [], buy: [], free: [] };
    if (!tw) return out;
    /* 同一個品牌的變體（例如 Netflix 與「Netflix basic with Ads」）會配到同一個 key，
       只留 display_priority 最小的那個，不然畫面上會出現兩顆一模一樣的標籤。 */
    function take(arr) {
      var sorted = (arr || []).slice().sort(function (a, b) {
        return (a.display_priority || 99) - (b.display_priority || 99);
      });
      var seen = {}, out = [];
      for (var i = 0; i < sorted.length; i++) {
        var b = normProvider(sorted[i]);
        if (seen[b.key]) continue;
        seen[b.key] = true;
        out.push(b);
      }
      return out;
    }
    out.flatrate = take(tw.flatrate);
    out.rent = take(tw.rent);
    out.buy = take(tw.buy);
    /* free / ads 併進「免費（含廣告）」 */
    out.free = take((tw.free || []).concat(tw.ads || []));
    return out;
  }

  function normOmdb(j) {
    function num(v) {
      var n = parseFloat(v);
      return isFinite(n) ? n : null;
    }
    var out = { imdb: null, rt: null, mc: null };
    if (!j) return out;
    if (j.imdbRating && j.imdbRating !== "N/A") out.imdb = num(j.imdbRating);
    var rs = j.Ratings || [];
    for (var i = 0; i < rs.length; i++) {
      var src = rs[i].Source, val = String(rs[i].Value || "");
      if (src === "Internet Movie Database" && out.imdb == null) out.imdb = num(val.split("/")[0]);
      if (src === "Rotten Tomatoes") out.rt = num(val.replace("%", ""));
      if (src === "Metacritic") out.mc = num(val.split("/")[0]);
    }
    if (out.mc == null && j.Metascore && j.Metascore !== "N/A") out.mc = num(j.Metascore);
    return out;
  }

  /* ---------- 快取包裝 ----------
     每個取數 API 都回 {v: 資料, t: 資料時間, cached: 是否命中快取} */
  function cached(key, ttl, loader) {
    var hit = HLM_Store.cacheGet(key, ttl);
    if (hit) return Promise.resolve({ v: hit.v, t: hit.t, cached: true });
    return loader().then(function (v) {
      HLM_Store.cacheSet(key, v);
      return { v: v, t: Date.now(), cached: false };
    }).catch(function (e) {
      /* API 掛掉時，寧可拿過期資料也不要開天窗（但要讓 UI 知道是舊的） */
      var stale = HLM_Store.cacheGet(key, -1);
      if (stale && (e.kind === "offline" || e.kind === "timeout" || e.kind === "server" || e.kind === "quota")) {
        return { v: stale.v, t: stale.t, cached: true, stale: true };
      }
      throw e;
    });
  }

  /* provider id 校正：TMDB 的 id 偶爾會變，開機用官方清單依名稱對一次（1 次呼叫、快取 30 天） */
  function syncProviderIds() {
    return cached("pvids", C.ttl.providerIds, function () {
      return tmdb("/watch/providers/movie", { watch_region: C.region, language: C.lang })
        .then(function (j) {
          var map = {}, arr = (j && j.results) || [];
          /* 逐個 provider 去問「這是哪個品牌」，跟 normProvider 用同一套比對規則，
             才不會兩邊對出不一樣的答案 */
          for (var i = 0; i < arr.length; i++) {
            var key = brandKeyByName(arr[i].provider_name);
            if (key && !map[key]) map[key] = arr[i].provider_id;
          }
          return map;
        });
    }).then(function (r) {
      for (var k in r.v) if (r.v[k]) HLM_BRAND[k].id = r.v[k];
      return r.v;
    }).catch(function () { return null; });   /* 校正失敗就用預設 id，不影響主流程 */
  }

  function cinemaList() {
    return cached("cine", C.ttl.listCinema, function () {
      return tmdb("/movie/now_playing", { region: C.region, language: C.lang, page: 1 }).then(normList);
    });
  }

  function streamList(pfKeys) {
    var ids = (pfKeys || []).map(function (k) { return HLM_BRAND[k] && HLM_BRAND[k].id; })
      .filter(Boolean).sort(function (a, b) { return a - b; });
    var key = "stream:" + (ids.join("|") || "all");
    return cached(key, C.ttl.listStream, function () {
      return tmdb("/discover/movie", {
        watch_region: C.region,
        language: C.lang,
        with_watch_monetization_types: "flatrate",
        with_watch_providers: ids.join("|"),
        sort_by: "popularity.desc",
        include_adult: false,
        page: 1
      }).then(normList);
    });
  }

  function search(kw) {
    var key = "q:" + String(kw).toLowerCase();
    return cached(key, C.ttl.search, function () {
      return tmdb("/search/movie", {
        query: kw, language: C.lang, region: C.region, include_adult: false, page: 1
      }).then(normList);
    });
  }

  function movie(id) {
    return cached("m:" + id, C.ttl.movie, function () {
      return tmdb("/movie/" + id, { language: C.lang, append_to_response: "external_ids,credits" })
        .then(function (j) {
          var m = normDetail(j);
          if (!m.overview) {
            /* zh-TW 常常沒有簡介 → 補抓一次英文版（只在缺的時候，結果一起快取 30 天） */
            return tmdb("/movie/" + id, { language: "en-US" }).then(function (j2) {
              m.overview = j2.overview || "";
              m.overviewLang = m.overview ? "en" : "";
              return m;
            }).catch(function () { return m; });
          }
          return m;
        });
    });
  }

  function providers(id) {
    return cached("pv:" + id, C.ttl.providers, function () {
      return tmdb("/movie/" + id + "/watch/providers", {}).then(normProviders);
    });
  }

  /* 只給列表用：命中快取才回，不會發出任何請求 */
  function providersCachedOnly(id) {
    var hit = HLM_Store.cacheGet("pv:" + id, C.ttl.providers);
    return hit ? hit.v : null;
  }

  function scores(imdbId) {
    if (!imdbId) return Promise.reject(err("notfound", "omdb", "沒有 imdb_id"));
    return cached("o:" + imdbId, C.ttl.omdb, function () {
      return omdb(imdbId).then(normOmdb);
    });
  }

  /* 測試連線：分別回 TMDB／OMDb 的明確結果 */
  function testTmdb(key) {
    if (!key) return Promise.resolve({ ok: false, msg: "還沒填 TMDB 金鑰。" });
    /* 最常見的手滑：貼到 API Read Access Token（JWT，eyJ 開頭）而不是 v3 金鑰 */
    if (key.indexOf("eyJ") === 0) {
      return Promise.resolve({
        ok: false,
        msg: "這串是 API Read Access Token（v4），不是這個 App 要的金鑰。回 TMDB 那一頁找「API Key (v3 auth)」，是 32 碼英數字、沒有句點。"
      });
    }
    return fetchJSON(C.tmdbBase + "/configuration?" + qs({ api_key: key }), "tmdb")
      .then(function () { return { ok: true, msg: "TMDB 正常，可以查片了。" }; })
      .catch(function (e) {
        var h = human(e);
        return { ok: false, msg: h.t + "：" + h.b };
      });
  }

  function testOmdb(key) {
    if (!key) return Promise.resolve({ ok: null, msg: "沒填 OMDb 金鑰也能用，只是看不到 IMDb／爛番茄／Metacritic 三個分數。" });
    return fetchJSON(C.omdbBase + "?" + qs({ apikey: key, i: "tt0111161", r: "json" }), "omdb")
      .then(function (j) {
        if (j && String(j.Response) === "False") throw err(omdbKind(j.Error), "omdb", j.Error);
        return { ok: true, msg: "OMDb 正常，詳細頁會有 IMDb／爛番茄／Metacritic。" };
      }).catch(function (e) {
        if (e.kind === "badkey") {
          return { ok: false, msg: "OMDb 金鑰無效，或啟用信還沒點。去信箱找 OMDb 寄來的信，點裡面那個連結啟用。" };
        }
        var h = human(e);
        return { ok: false, msg: h.t + "：" + h.b };
      });
  }

  return {
    err: err, human: human, ptt: ptt, pttFor: pttFor,
    syncProviderIds: syncProviderIds,
    cinemaList: cinemaList, streamList: streamList, search: search,
    movie: movie, providers: providers, providersCachedOnly: providersCachedOnly, scores: scores,
    testTmdb: testTmdb, testOmdb: testOmdb,
    _normOmdb: normOmdb, _normProviders: normProviders, _brandKeyByName: brandKeyByName, _normList: normList, _normDetail: normDetail
  };
})();

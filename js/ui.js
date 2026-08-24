/* 好雷嗎? — 畫面片段（純字串產生器，不碰狀態）
   版面／文案／狀態一律照 lab-ux 定案的 demo，改動前先看 CLAUDE.md 的「別誤改」。 */
var HLM_UI = (function () {
  "use strict";

  var C = HLM_CFG;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtVotes(n) {
    if (!n) return "";
    if (n >= 10000) return (Math.round(n / 1000) / 10) + " 萬人評";
    return n.toLocaleString("en-US") + " 人評";
  }
  function toneColor(n) { return n >= 75 ? "#41d18a" : (n >= 55 ? "#ffb020" : "#ff5f6b"); }
  function toneWord(n) {
    return n >= 85 ? "非常值得看" : (n >= 75 ? "值得看" : (n >= 60 ? "看看可以" : (n >= 45 ? "普通偏弱" : "不太推薦")));
  }
  /* "2026-12-18" → "2026 年 12 月 18 日"（照定案 demo 的寫法） */
  function fmtDateLong(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
    if (!m) return String(d || "");
    return m[1] + " 年 " + parseInt(m[2], 10) + " 月 " + parseInt(m[3], 10) + " 日";
  }
  /* "2026-08-20" → "8/20" */
  function fmtMD(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
    if (!m) return "";
    return parseInt(m[2], 10) + "/" + parseInt(m[3], 10);
  }
  /* 上映幾天了；未來或無效日期回 null */
  function daysSinceRelease(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
    if (!m) return null;
    var rel = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((today - rel) / 86400000);
    return diff < 0 ? null : diff;
  }

  function fmtTime(ts) {
    var d = new Date(ts), p = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* 綜合分數：有值的分數 >=2 項才算，純算術平均（不是 AI 判斷） */
  function aggregate(m, sc) {
    var v = [];
    if (sc) {
      if (sc.imdb != null) v.push(sc.imdb * 10);
      if (sc.rt != null) v.push(sc.rt);
      if (sc.mc != null) v.push(sc.mc);
    }
    if (m.tmdb != null) v.push(m.tmdb * 10);
    if (v.length < 2) return null;
    var s = 0;
    for (var i = 0; i < v.length; i++) s += v[i];
    return { score: Math.round(s / v.length), count: v.length };
  }

  /* ---------- 海報（無圖時的漸層佔位也是正式版的一部分） ---------- */
  function posterHTML(m, big) {
    var t = String(m.zh || m.en || "?");
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    var bg = "linear-gradient(150deg,hsl(" + h + ",42%,36%),hsl(" + ((h + 28) % 360) + ",48%,11%))";
    var img = "";
    if (m.poster) {
      img = '<img src="' + C.imgBase + (big ? C.imgDetail : C.imgList) + m.poster + '" alt="" loading="lazy" decoding="async"' +
        ' onerror="this.parentNode.classList.remove(\'has\');this.remove();">';
    }
    return '<div class="poster' + (big ? " big" : "") + (m.poster ? " has" : "") + '" style="background:' + bg + '">' +
      esc(t.slice(0, 1)) + img + '</div>';
  }

  /* ---------- 列表 ---------- */
  /* 列表分數只有 TMDB（省 API）→ 藍色 TMDB 標籤 + 10 分制數字 + 評分人數，
     刻意跟詳細頁的 0~100 圓環長得不一樣，避免被誤讀成綜合分。 */
  function tmdbPill(m) {
    if (m.tmdb == null) {
      return '<span class="tpill na"><span class="k">TMDB</span><span class="v">尚無評分</span></span>';
    }
    return '<span class="tpill"><span class="k">TMDB</span><span class="v" style="color:' +
      toneColor(m.tmdb * 10) + '">' + m.tmdb.toFixed(1) + '</span></span>';
  }

  function votesHTML(m) {
    if (m.tmdb == null) return m.upcoming ? "" : '<span class="votes weak">剛上映，還沒人評</span>';
    if (m.votes < 50) return '<span class="votes weak">僅 ' + m.votes + ' 人評，還不準</span>';
    return '<span class="votes">' + fmtVotes(m.votes) + "</span>";
  }

  function dotsHTML(list) {
    return '<span class="pv-dots">' + list.slice(0, 3).map(function (b) {
      return '<span class="pv-dot" style="background:' + b.c + '">' +
        (b.s ? esc(b.s) : (b.logo ? '<img src="' + C.imgBase + C.imgLogo + b.logo + '" alt="">' : esc((b.n || "?").slice(0, 2)))) +
        "</span>";
    }).join("") + "</span>";
  }

  /* mode: cinema / stream / search；pv 是觀看平台（可能還沒抓到 → null） */
  function metaHTML(m, mode, pv) {
    var extra = "";
    /* 未上映一定優先：TMDB 的 now_playing 有時候會夾帶還沒上映的片，
       標成「上映中」是騙人的（QA 抓到） */
    if (m.upcoming) {
      extra = '<span class="tag soon">尚未上映</span>' +
        (m.date ? '<span class="votes">' + fmtMD(m.date) + " 上映</span>" : "");
    } else if (mode === "cinema") {
      /* 他說電影院片單有時效性 → 標出這週新上的，並附上映日 */
      var days = daysSinceRelease(m.date);
      extra = '<span class="tag cinema">' + (days !== null && days <= 7 ? "本週新上映" : "上映中") + "</span>" +
        (m.date ? '<span class="votes">' + fmtMD(m.date) + " 上映</span>" : "");
    } else if (pv && pv.flatrate && pv.flatrate.length) {
      extra = dotsHTML(pv.flatrate);
    } else if (pv && pv.free && pv.free.length) {
      extra = dotsHTML(pv.free);
    } else if (mode === "search" && m.inCinema) {
      extra = '<span class="tag cinema">電影院上映中</span>';
    } else if (pv && ((pv.rent && pv.rent.length) || (pv.buy && pv.buy.length))) {
      extra = '<span class="tag">僅租借／購買</span>';
    }
    return tmdbPill(m) + votesHTML(m) + extra;
  }

  function rowHTML(m, mode, pv) {
    var sub = esc(m.en || m.zh) + (m.year ? " · " + m.year : "") + (m.runtime ? " · " + m.runtime + " 分鐘" : "");
    return '<button class="row" type="button" data-open="' + m.id + '">' + posterHTML(m, false) +
      '<div class="rowmain"><div class="rowtitle">' + esc(m.zh) + "</div>" +
      '<div class="rowsub">' + sub + "</div>" +
      '<div class="rowmeta" data-meta="' + m.id + '">' + metaHTML(m, mode, pv) + "</div></div></button>";
  }

  function skeletonRows(n) {
    var o = "";
    for (var i = 0; i < n; i++) {
      o += '<div class="row"><div class="skel" style="width:56px;aspect-ratio:2/3;border-radius:9px;"></div>' +
        '<div class="rowmain"><div class="skel" style="height:16px;width:62%;"></div>' +
        '<div class="skel" style="height:12px;width:80%;"></div>' +
        '<div class="skel" style="height:12px;width:44%;"></div></div></div>';
    }
    return o;
  }

  /* ---------- 空狀態 / 錯誤 ---------- */
  var ICON_TV = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6b7484" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M7 10.5h10"/></svg>';
  var ICON_SEARCH = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6b7484" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>';

  function emptyPf() {
    return '<div class="empty"><div class="big">' + ICON_TV + "</div>" +
      "<h3>你選的平台目前沒有片</h3><p>換個平台試試，或看看全部。</p>" +
      '<div class="chips" style="justify-content:center"><button class="chip" type="button" data-pf="__all">看全部平台</button></div></div>';
  }

  function emptySearch(kw) {
    return '<div class="empty"><div class="big">' + ICON_SEARCH + "</div>" +
      "<h3>找不到「" + esc(kw) + "」</h3><p>可能是片名打錯、或這部片還沒被資料庫收錄。<br>試試原文片名，或少打幾個字。</p>" +
      '<div class="chips" style="justify-content:center">' +
      '<button class="chip" type="button" data-kw="沙丘">沙丘</button>' +
      '<button class="chip" type="button" data-kw="小丑">小丑</button>' +
      '<button class="chip" type="button" data-kw="star wars">Star Wars</button></div></div>';
  }

  function emptyList(title, body) {
    return '<div class="empty"><div class="big">' + ICON_TV + "</div><h3>" + esc(title) + "</h3><p>" + body + "</p></div>";
  }

  /* 錯誤卡：四類錯誤各給人話 + 下一步 */
  function errorBox(e) {
    var h = HLM_Api.human(e);
    var act = h.a === "setup"
      ? '<button class="btn pri" type="button" data-act="setup">' + esc(h.al) + "</button>"
      : '<button class="btn pri" type="button" data-act="retry">' + esc(h.al) + "</button>" +
        '<button class="btn" type="button" data-act="setup">檢查金鑰</button>';
    return '<div class="errbox hard"><h3>' + esc(h.t) + "</h3><p>" + esc(h.b) + '</p><div class="acts">' + act + "</div></div>";
  }

  /* ---------- 詳細頁 ---------- */
  function scoreCard(kind, val, loading) {
    var cfg = {
      imdb: { n: "IMDb", bg: "#f5c518", fg: "#0b0d12", sfx: " / 10", lab: "IMDb 使用者評分" },
      rt: { n: "爛番茄", bg: "#fa542a", fg: "#fff", sfx: "%", lab: "爛番茄影評新鮮度" },
      mc: { n: "Meta", bg: "#2fd08a", fg: "#08120d", sfx: " / 100", lab: "Metacritic 影評分數" },
      tmdb: { n: "TMDB", bg: "#22c1e8", fg: "#04141a", sfx: " / 10", lab: "TMDB 觀眾評分" }
    }[kind];
    var badge = '<span class="badge" style="background:' + cfg.bg + ";color:" + cfg.fg + '">' + cfg.n + "</span>";
    if (loading) {
      return '<div class="sc">' + badge + '<span class="sv"><span class="skel" style="height:16px;width:52px;display:block;margin-bottom:5px;"></span>' +
        '<span class="skel" style="height:10px;width:74px;display:block;"></span></span></div>';
    }
    if (val == null) {
      return '<div class="sc na">' + badge + '<span class="sv"><b>—</b><span>查無收錄</span></span></div>';
    }
    var shown = kind === "imdb" || kind === "tmdb" ? Number(val).toFixed(1) : Math.round(val);
    return '<div class="sc">' + badge + '<span class="sv"><b>' + shown +
      '<span style="font-size:11px;color:#6b7484;font-weight:600">' + cfg.sfx + "</span></b><span>" + cfg.lab + "</span></span></div>";
  }

  /* 平台一律是資訊標籤，不可點、不外連 */
  function pvGroup(list, label, hot) {
    if (!list || !list.length) return "";
    return '<div class="pvgroup"><div class="pvlabel"><span class="pill' + (hot ? " hot" : "") + '">' + esc(label) + "</span></div><div class=\"pvrow\">" +
      list.map(function (b) {
        var sq = b.s
          ? esc(b.s)
          : (b.logo ? '<img src="' + C.imgBase + C.imgLogo + b.logo + '" alt="">' : esc((b.n || "?").slice(0, 2)));
        return '<span class="pv"><span class="sq" style="background:' + b.c + '">' + sq + "</span>" + esc(b.n) + "</span>";
      }).join("") + "</div></div>";
  }

  function watchSection(m, pv, pvLoading) {
    if (pvLoading) {
      return '<div class="pvrow">' +
        '<span class="skel" style="height:38px;width:118px;border-radius:11px;"></span>' +
        '<span class="skel" style="height:38px;width:98px;border-radius:11px;"></span></div>';
    }
    var inner = "";
    if (m.inCinema && !m.upcoming) {
      inner += '<div class="pvgroup" style="margin-top:0"><div class="pvlabel"><span class="pill hot">現正上映</span></div>' +
        '<div class="pvrow"><span class="pv"><span class="sq" style="background:#ff5f6b">影</span>全台戲院上映中</span></div></div>';
    }
    if (pv) {
      inner += pvGroup(pv.free, "免費（含廣告）", true);
      inner += pvGroup(pv.flatrate, "訂閱可看", true);
      inner += pvGroup(pv.rent, "租借", false);
      inner += pvGroup(pv.buy, "購買", false);
    }
    if (!inner) {
      inner = '<div style="text-align:center;padding:18px 8px;color:var(--muted);font-size:13.5px;line-height:1.7;">' +
        (m.upcoming ? "這部片還沒上映，<br>上映後才會有觀看平台資訊。"
          : "目前台灣查不到任何線上觀看管道。<br>可能已下架，或尚未在台灣上架。") + "</div>";
    } else if (pv && ((pv.rent && pv.rent.length) || (pv.buy && pv.buy.length))) {
      inner += '<p class="pvnote">租借／購買的價格各平台不同，TMDB 不提供價格，這裡只列得到哪裡有。</p>';
    }
    return inner;
  }

  /* ready=false → OMDb 還沒回來，只有 TMDB 的部分先畫（不可以改成等齊才顯示） */
  /* ================= PTT 鄉民風向 =================
     設計主張（lab-ux §9，老闆看過 demo 確認）：
     **不給 PTT 一個分數**——不換算 0～100、不進綜合分數環，只給比例條＋票數＋一句結論詞。
     上面四個是網站給的分數，這一塊是真人一票一票投的，兩者不該長得像。 */
  var PTTCLS = { "好雷": "g", "普雷": "o", "負雷": "b" };
  var PTTCOL = { g: "#41d18a", o: "#ffb020", b: "#ff5f6b" };

  /* 結論詞：純比例，照規格 §9.4 抄，不要自己調門檻 */
  function pttVerdict(g, o, b) {
    var n = g + o + b, gr = g / n, br = b / n;
    if (gr >= 0.80) return { w: "幾乎全是好雷", c: PTTCOL.g, split: false };
    if (br >= 0.50) return { w: "負雷居多", c: PTTCOL.b, split: false };
    if (gr >= 0.60 && br <= 0.25) return { w: "好雷佔多數", c: PTTCOL.g, split: false };
    if (gr >= 0.35 && br >= 0.30) return { w: "評價兩極", c: PTTCOL.o, split: true };
    if (br >= 0.30) return { w: "偏向負雷", c: PTTCOL.b, split: false };
    return { w: "風向普通", c: PTTCOL.o, split: false };
  }

  /* 比例條寬度：非零段至少 4%（不然看不到），三段算完再正規化回 100% */
  function pttSegs(g, o, b) {
    var n = g + o + b;
    var a = [g, o, b].map(function (v) { return v ? Math.max(4, v / n * 100) : 0; });
    var t = a[0] + a[1] + a[2];
    return a.map(function (v) { return v / t * 100; });
  }

  /* 預設顯示 5 則＝推文前 4 則 ＋「保底異見」1 則。
     ⚠️ 這是刻意的，不是排序 bug：posts 已依推文數排好，一面倒的片會讓少數派永遠被擠掉，
        但「有沒有人覺得雷」正是這個 App 的名字在問的事。**不要改成純推文排序。** */
  function pttPicks(posts) {
    if (posts.length <= 5) return posts.slice();
    var top = posts.slice(0, 4), rest = posts.slice(4), i;
    var hasBad = false, hasGood = false;
    for (i = 0; i < top.length; i++) {
      if (top[i].tag === "負雷") hasBad = true;
      if (top[i].tag === "好雷") hasGood = true;
    }
    var want = !hasBad ? "負雷" : (!hasGood ? "好雷" : null);
    var pick = null;
    if (want) for (i = 0; i < rest.length; i++) if (rest[i].tag === want) { pick = rest[i]; break; }
    if (!pick) pick = rest[0];
    return top.concat([pick]);
  }

  /* 標題前面的 [好雷] 剝掉（左邊已經有色標籤了）；剝不掉就原樣顯示，不要整則丟掉 */
  function pttTitle(t) {
    return String(t == null ? "" : t).replace(/^\s*[\[［]\s*(好雷|普雷|負雷|雷|有雷|無雷)\s*[\]］]\s*/, "");
  }

  /* 「更新於 今天 HH:mm」／「更新於 8/20 14:30」；用 JSON 的 updated，不是抓取時間 */
  function pttStamp(updated) {
    var t = Date.parse(updated || "");
    if (!t) return "";
    var d = new Date(t), now = new Date(), p = function (x) { return String(x).padStart(2, "0"); };
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return "更新於 " + (sameDay ? "今天" : (d.getMonth() + 1) + "/" + d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* 資料幾天沒更新（用 updated 算）；算不出來回 null */
  function pttStaleDays(updated) {
    var t = Date.parse(updated || "");
    if (!t) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  var PTTARROW = '<svg class="pttarrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

  /* ⭐ 網址白名單：只有 https://(www.)ptt.cc/... 才輸出 <a>。
     esc() 只擋得住「把屬性撐破」，**擋不住 scheme**——
     資料檔如果被污染（或哪天爬蟲被騙），javascript: 會在本站 origin 上執行，
     data: 與外站網址則變成釣魚跳板。認不得的網址就退成純文字列：
     標題照樣看得到，只是不能點。**不要為了「總是可以點」把這條拿掉。** */
  var PTTOK = /^https:\/\/(?:www\.)?ptt\.cc\//;

  function pttPostHTML(t) {
    var cls = PTTCLS[t.tag] || "o";       /* 認不得的 tag 一律當普雷樣式，不要漏顯示、不要壞掉 */
    var tag = PTTCLS[t.tag] ? t.tag : "普雷";
    var inner = '<span class="ptttag ' + cls + '">' + esc(tag) + "</span>" +
      '<span class="pttbody"><span class="pttt">' + esc(pttTitle(t.title)) + "</span>" +
      '<span class="pttmeta">推 ' + (Number(t.push) || 0) + " · " + esc(t.date || "") + "</span></span>";
    if (!PTTOK.test(String(t.url || ""))) return '<span class="pttpost nolink">' + inner + "</span>";
    /* 外連：PTT 文章連結是「繼續讀評價」，不是導購（界線見 CLAUDE.md／規格 §9.7） */
    return '<a class="pttpost" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' +
      inner + PTTARROW + "</a>";
  }

  /**
   * PTT 卡片的內容（不含外面那層 .card）。
   * p = { loading, err, data(整份 JSON), open }
   * 五種狀態都在這裡：量夠／量太少／沒討論／過期／讀取失敗（規格 §9.6）
   */
  function pttHTML(id, p) {
    p = p || {};
    var head = function (stamp, stale) {
      return '<div class="ptthead"><p class="sec-title">PTT 鄉民風向</p>' +
        (stamp ? '<span class="pttstamp' + (stale ? " stale" : "") + '">' + esc(stamp) + "</span>" : "") + "</div>";
    };

    if (p.loading) {
      return head("") +
        '<div class="skel" style="height:12px;border-radius:999px;margin-bottom:14px;"></div>' +
        '<div class="skel" style="height:14px;width:70%;margin-bottom:10px;"></div>' +
        '<div class="skel" style="height:14px;width:52%;"></div>';
    }

    /* 狀態 5b：讀不到整份資料。⚠️ 一定要跟「沒有討論」長得不一樣——
       混在一起會讓人以為冷門片壞掉，或以為爬蟲掛了只是沒人討論。 */
    if (p.err) {
      return head("讀不到") +
        '<div class="ptterr"><p>PTT 討論資料暫時讀不到。<br>可能是網路不穩，或資料檔正在更新。</p>' +
        '<button type="button" id="pttretry">重試</button></div>';
    }

    var data = p.data || {};
    var days = pttStaleDays(data.updated);
    var stale = days !== null && days >= C.pttStaleDays;
    var H = head(pttStamp(data.updated), stale);

    var d = HLM_Api.pttFor(data, id);
    /* 狀態 3：完全沒有討論（多數片都是這個狀態，所以壓成一行灰字，不用大圖示空狀態） */
    if (!d || (d.good + d.ok + d.bad) === 0) {
      return H + '<div class="pttnone"><span class="qm">?</span><span>' +
        "PTT 電影板查不到這部片的雷文。<br>老片、冷門片或非院線片通常都不會有。</span></div>";
    }

    var g = d.good, o = d.ok, b = d.bad, n = g + o + b;
    var shown = p.open ? d.posts : pttPicks(d.posts);
    var list = d.posts.length ? '<div class="pttlist">' + shown.map(pttPostHTML).join("") + "</div>" : "";
    var more = d.posts.length > shown.length
      ? '<button class="morebtn" type="button" id="pttmore">展開全部 ' + d.posts.length + " 則</button>"
      : (p.open && d.posts.length > 5 ? '<button class="morebtn" type="button" id="pttmore">收合</button>' : "");
    var staleWarn = stale
      ? '<p class="pttwarn">PTT 資料已經 ' + days + " 天沒更新，可能漏掉最新的討論。</p>" : "";
    /* 一行處理三件事：資料性質、爆雷告知、會離開 App。不要拆成三個提示框。 */
    var foot = '<p class="pttfoot">共 ' + n + " 篇 PTT 電影板心得。好雷／普雷／負雷是鄉民自己在標題標的，" +
      "不是評分網站的分數。標題由發文者自訂、可能含劇情，點了會用瀏覽器開啟 PTT。</p>";

    /* 狀態 2：1～3 篇。刻意不畫比例條也不給結論詞——3 篇算出「67% 好雷」是說謊 */
    if (n <= 3) {
      return H + '<p class="pttwarn">PTT 上只有 ' + n + " 篇心得，還看不出風向，看看就好。</p>" +
        list + more + staleWarn + foot;
    }

    var v = pttVerdict(g, o, b), sg = pttSegs(g, o, b);
    var bar = '<div class="pttbar">' +
      (g ? '<i style="width:' + sg[0].toFixed(2) + "%;background:" + PTTCOL.g + '"></i>' : "") +
      (o ? '<i style="width:' + sg[1].toFixed(2) + "%;background:" + PTTCOL.o + '"></i>' : "") +
      (b ? '<i style="width:' + sg[2].toFixed(2) + "%;background:" + PTTCOL.b + '"></i>' : "") + "</div>";
    var legend = '<div class="pttlegend">' +
      '<span><i class="dot" style="background:' + PTTCOL.g + '"></i>好雷 <b>' + g + "</b></span>" +
      '<span><i class="dot" style="background:' + PTTCOL.o + '"></i>普雷 <b>' + o + "</b></span>" +
      '<span><i class="dot" style="background:' + PTTCOL.b + '"></i>負雷 <b>' + b + "</b></span></div>";
    /* 只有「評價兩極」才給提示框；一面倒不給（結論詞已經講完了，同一頁不該有兩個琥珀框） */
    var split = v.split
      ? '<div class="divergent"><span class="warnmark">!</span><span>鄉民吵很兇：' + g + " 篇好雷、" + b +
        " 篇負雷咬得很緊。這種片體質偏兩極，很可能不是「好不好看」而是「合不合你胃口」。</span></div>" : "";

    return H +
      '<div class="pttsum"><div class="pttword" style="color:' + v.c + '">' + v.w + "</div>" +
      '<div class="pttrate">好雷率 <b style="color:' + v.c + '">' + Math.round(g / n * 100) + "%</b></div></div>" +
      bar + legend + split + list + more + staleWarn + foot;
  }

  function detailHTML(m, ctx) {
    var sc = ctx.scores, ready = ctx.ready, agg = ready ? aggregate(m, sc) : null, ringHTML;

    if (!ready) {
      ringHTML = '<div class="skel" style="width:88px;height:88px;border-radius:50%;flex:0 0 auto;"></div>' +
        '<div class="vtext"><span class="skel" style="height:11px;width:64px;display:block;margin-bottom:8px;"></span>' +
        '<span class="skel" style="height:19px;width:110px;display:block;margin-bottom:8px;"></span>' +
        '<span class="skel" style="height:11px;width:88%;display:block;"></span></div>';
    } else if (!agg) {
      var why = m.upcoming ? "本片尚未上映，各站都還沒有評分。"
        : (ctx.scoreErr === "nokey" ? "還沒設定 OMDb 金鑰，所以只有 TMDB 一個分數，算平均沒有意義。"
          : "各評分網站對這部片的收錄不足（有分數的少於 2 項），算平均沒有意義。");
      ringHTML = '<div class="ring na"><span class="num">資料<br>不足</span></div>' +
        '<div class="vtext"><div class="lab">綜合評價</div><div class="word" style="color:var(--muted)">還無法判斷</div>' +
        '<div class="note">' + esc(why) + "</div></div>";
    } else {
      var c = toneColor(agg.score);
      ringHTML = '<div class="ring" style="--pct:' + agg.score + ";--ring-c:" + c + '"><span class="num" style="color:' + c + '">' +
        agg.score + "<small>/100</small></span></div>" +
        '<div class="vtext"><div class="lab">綜合評價</div><div class="word" style="color:' + c + '">' + toneWord(agg.score) + "</div>" +
        '<div class="note">由 ' + agg.count + " 個網站的分數換算平均。" + (agg.count < 4 ? "（部分網站查無資料）" : "") + "</div></div>";
    }

    var diverge = "";
    if (ready && sc && sc.imdb != null && sc.rt != null && Math.abs(sc.imdb * 10 - sc.rt) >= 20) {
      var critHigh = sc.rt > sc.imdb * 10;
      diverge = '<div class="divergent"><span class="warnmark">!</span><span>' +
        (critHigh ? "影評人給了高分（" + Math.round(sc.rt) + "%），一般觀眾卻明顯不買單（IMDb " + sc.imdb.toFixed(1) + "）。這種片通常有人很愛、有人很雷。"
          : "一般觀眾評價（IMDb " + sc.imdb.toFixed(1) + "）明顯高於影評人（爛番茄 " + Math.round(sc.rt) + "%）。爽片體質，別太看影評。") +
        "</span></div>";
    }

    /* OMDb 失敗但不是「查無收錄」時，說明為什麼三個分數沒出來 */
    var scoreNote = "";
    if (ready && ctx.scoreErr && ctx.scoreErr !== "notfound") {
      var hm = HLM_Api.human({ kind: ctx.scoreErr, src: "omdb" });
      scoreNote = '<p class="hintline" style="margin:12px 0 0">IMDb／爛番茄／Metacritic 這次沒查到：' + esc(hm.t) + "。" + esc(hm.b) + "</p>";
    }

    var pv = ctx.pv;
    var avail;
    if (m.inCinema && !m.upcoming) avail = '<span class="availnow cine"><span class="bdot" style="background:#ff5f6b"></span>電影院上映中</span>';
    else if (pv && pv.flatrate && pv.flatrate.length) avail = '<span class="availnow"><span class="bdot" style="background:#41d18a"></span>' + esc(pv.flatrate[0].n) + " 訂閱可看</span>";
    else if (pv && pv.free && pv.free.length) avail = '<span class="availnow"><span class="bdot" style="background:#41d18a"></span>' + esc(pv.free[0].n) + " 免費可看</span>";
    else if (m.upcoming) avail = '<span class="availnow none">' + esc(m.date ? fmtDateLong(m.date) + "上映" : "尚未上映") + "</span>";
    else if (ctx.pvLoading) avail = '<span class="skel" style="height:30px;width:132px;border-radius:10px;margin-top:4px;display:block;"></span>';
    else if (pv && ((pv.rent && pv.rent.length) || (pv.buy && pv.buy.length))) avail = '<span class="availnow none">僅租借／購買</span>';
    else avail = '<span class="availnow none">台灣查無觀看管道</span>';

    var metaLine = (m.year || "") + (m.runtime ? " · " + m.runtime + " 分鐘" : "") +
      (m.genres && m.genres.length ? " · " + m.genres.join("、") : "");

    var ov = m.overview || "";
    var ovBlock = ov
      ? '<div class="overview clamp" id="ov">' + esc(ov) + "</div>" +
        (m.overviewLang === "en" ? '<p class="hintline" style="margin:8px 0 0">TMDB 沒有這部片的中文簡介，上面是英文原文。</p>' : "") +
        '<button class="morebtn" id="ovbtn" type="button">展開全部</button>'
      : '<p class="hintline" style="margin:0">TMDB 上還沒有這部片的劇情簡介。</p>';

    var credits = "";
    if (m.director) credits += '<div><span class="k">導演</span><span class="v">' + esc(m.director) + "</span></div>";
    if (m.cast && m.cast.length) credits += '<div><span class="k">主演</span><span class="v">' + m.cast.map(esc).join("、") + "</span></div>";
    if (!credits) credits = '<div><span class="k">—</span><span class="v" style="color:var(--faint)">TMDB 查無演職員資料</span></div>';

    var stamp = ctx.stamp ? "更新於 " + fmtTime(ctx.stamp) + "。" : "";
    var staleNote = ctx.stale ? "（目前連不上網路，顯示的是上次存下來的資料）" : "";

    return '<div class="hero">' + posterHTML(m, true) +
      '<div class="heroinfo"><h2>' + esc(m.zh) + "</h2>" +
      '<div class="orig">' + esc(m.en) + "</div>" +
      '<div class="meta">' + esc(metaLine) + "</div>" + avail + "</div></div>" +

      '<div class="card block"><div class="verdict">' + ringHTML + "</div>" +
      '<div class="scores">' +
      scoreCard("tmdb", m.tmdb, false) +
      scoreCard("imdb", sc ? sc.imdb : null, !ready) +
      scoreCard("rt", sc ? sc.rt : null, !ready) +
      scoreCard("mc", sc ? sc.mc : null, !ready) +
      "</div>" + diverge +
      (m.tmdb != null && m.votes < 50 ? '<p class="hintline" style="margin:12px 0 0">TMDB 只有 ' + m.votes + " 人評分，這個分數參考價值有限。</p>" : "") +
      scoreNote +
      "</div>" +

      /* PTT 插在四個分數與平台之間：兩者都在回答「值不值得看」，必須相鄰；
         平台回答的是「我打不打得開」，要留在後面（規格 §9.1） */
      '<div class="card block" id="pttcard">' + pttHTML(m.id, ctx.ptt) + "</div>" +

      '<div class="card block"><p class="sec-title">台灣哪裡看得到</p>' + watchSection(m, pv, ctx.pvLoading) + "</div>" +

      '<div class="card block"><p class="sec-title">劇情簡介</p>' + ovBlock + "</div>" +

      '<div class="card block"><p class="sec-title">演職員</p><div class="credits">' + credits + "</div></div>" +

      '<div class="srcfoot">資料來源：TMDB（片名／海報／簡介／台灣觀看平台）、OMDb（IMDb／爛番茄／Metacritic）。' +
      esc(stamp) + esc(staleNote) + '<br><button type="button" id="refresh">重新抓一次這部片</button></div>' +

      '<div class="backbar"><button type="button" id="back2">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>' +
      esc(ctx.backLabel || "返回") + "</button></div>";
  }

  function detailSkeleton() {
    return '<div class="hero"><div class="skel" style="width:104px;aspect-ratio:2/3;border-radius:12px;flex:0 0 auto;"></div>' +
      '<div class="heroinfo"><span class="skel" style="height:22px;width:70%;display:block;"></span>' +
      '<span class="skel" style="height:13px;width:86%;display:block;"></span>' +
      '<span class="skel" style="height:13px;width:56%;display:block;"></span></div></div>' +
      '<div class="card block"><div class="verdict">' +
      '<div class="skel" style="width:88px;height:88px;border-radius:50%;flex:0 0 auto;"></div>' +
      '<div class="vtext"><span class="skel" style="height:19px;width:60%;display:block;margin-bottom:8px;"></span>' +
      '<span class="skel" style="height:11px;width:88%;display:block;"></span></div></div>' +
      '<div class="scores">' + scoreCard("tmdb", null, true) + scoreCard("imdb", null, true) +
      scoreCard("rt", null, true) + scoreCard("mc", null, true) + "</div></div>";
  }

  /* ---------- 設定 / 第一次使用 ---------- */
  /* 「我訂了哪些平台」的 chips；也用於原地重畫（不可以重畫整個設定頁，會把他打到一半的金鑰吃掉） */
  function mysubsChips(sel) {
    return HLM_FILTERABLE.map(function (key) {
      var b = HLM_BRAND[key];
      return '<button class="pf' + (sel.indexOf(key) >= 0 ? " on" : "") + '" type="button" data-sub="' + key + '">' +
        '<span class="sq" style="background:' + b.c + '">' + b.s + "</span>" + esc(b.n) + "</button>";
    }).join("");
  }

  /* ---------- 手貼金鑰（逃生門） ----------
     ⚠️ v1.3.0 起這不是平常會看到的畫面：金鑰是鑰匙圈公開值自動帶進來的。
     這一段只在「拿不到金鑰」時出現，讓他不會被鎖在門外。
     ⚠️ 這支跟整個 ui.js 一樣**完全不碰 Keyring**（只吃布林值與字串）——
     模組壞掉時連錯誤畫面都畫不出來的話，那才是真的鎖死（QA 2026-08-23 的教訓）。 */
  function keyFormHTML(k) {
    return '<div class="card step"><h3>自己貼金鑰</h3>' +
      '<p class="sub" style="margin:0 0 12px">你貼的會<b>優先於</b>鑰匙圈的值，存在這台裝置上。</p>' +
      "<ol>" +
      '<li>TMDB：開 <a class="linkbtn" href="' + C.urlTmdbKey + '" target="_blank" rel="noopener">themoviedb.org 的 API 設定頁</a>，' +
      "拿 <b>API Key (v3 auth)</b>（不要 <b>API Read Access Token</b>，開頭 eyJ… 那個長的）</li>" +
      '<li>OMDb（選填）：開 <a class="linkbtn" href="' + C.urlOmdbKey + '" target="_blank" rel="noopener">omdbapi.com 的申請頁</a>，' +
      "選 <b>FREE!（1,000 daily limit）</b>；<b>信裡的啟用連結一定要點下去</b>，沒點的金鑰是死的</li>" +
      "</ol>" +
      '<div class="field"><label for="ktmdb">TMDB API Key (v3 auth)</label>' +
      '<input id="ktmdb" type="text" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="貼上 32 碼英數字" value="' + esc(k.tmdb) + '">' +
      '<p class="sub">沒有這個，App 什麼都查不到。</p></div>' +
      '<div class="field"><label for="komdb">OMDb API Key</label>' +
      '<input id="komdb" type="text" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="貼上 8 碼金鑰（可以先空著）" value="' + esc(k.omdb) + '">' +
      '<p class="sub">沒填也能用，只是詳細頁看不到 IMDb、爛番茄、Metacritic 三個分數。</p></div>' +
      '<div class="acts">' +
      '<button class="btn pri wide" type="button" id="saveTest">儲存並測試連線</button>' +
      '<button class="btn wide" type="button" id="justSave">只儲存</button>' +
      "</div><div id=\"testout\"></div></div>";
  }

  /**
   * 拿不到金鑰時的畫面（首頁片單區）。
   * ctx = { loading, why, hasModule, lsBroken }  ← **只有布林值與字串，不碰任何模組**
   */
  function keyErrorHTML(k, ctx) {
    ctx = ctx || {};
    if (ctx.loading) {
      return '<div class="empty"><h3>正在拿金鑰…</h3>' +
        "<p>第一次打開要跟鑰匙圈拿一次，通常一秒內就好。</p></div>";
    }
    var why = ctx.why || "拿不到鑰匙圈上的金鑰。";
    return '<div style="padding:0 16px">' +
      '<div class="errbox hard"><h3>現在還不能查片</h3>' +
      "<p>" + esc(why) + "</p>" +
      (ctx.hasModule ? '<div class="acts" style="margin-top:12px">' +
        '<button class="btn wide" type="button" id="krretry">再試一次</button></div>' : "") +
      "</div>" +
      (ctx.lsBroken ? '<div class="errbox hard"><h3>這個瀏覽器不讓我存資料</h3>' +
        "<p>可能是無痕模式或隱私設定。金鑰跟快取只會活到這個分頁關掉為止，每次開都要重貼。用一般（非無痕）視窗開就好。</p></div>" : "") +
      keyFormHTML(k) + "</div>";
  }

  function setupHTML(k, firstRun) {
    /* v1.3.0：金鑰由鑰匙圈的公開值自動帶進來，**設定頁不再有手貼金鑰的表單**。
       手貼是逃生門（見 keyErrorHTML），只有在拿不到金鑰時才出現。
       這裡只在「他真的手貼過」時顯示一行狀態＋清掉，免得他想換卻找不到地方。 */
    return '<div class="setup">' +
      "<h2>設定</h2>" +
      '<p class="lead">金鑰是從鑰匙圈自動拿的，平常不用管它。</p>' +

      '<div class="card step"><h3>金鑰</h3>' +
      (k.manual
        ? '<p class="sub" style="margin:0 0 12px">目前用的是<b>你自己貼的</b>金鑰（優先於鑰匙圈）：TMDB ' +
          esc(k.tmdbMask) + (k.omdb ? "、OMDb " + esc(k.omdbMask) : "、沒有 OMDb") + "</p>" +
          '<button class="btn wide" type="button" id="mkclear">清掉我貼的，改用鑰匙圈的</button>'
        : '<p class="sub" style="margin:0">' + (k.tmdb
            ? "來自鑰匙圈的公開設定，這個 App 不需要登入。"
            : "現在拿不到金鑰。回上一頁會看到怎麼處理。") + "</p>") +
      "</div>" +

      '<div class="card step"><h3>我訂了哪些平台</h3>' +
      '<p class="sub" style="margin:0 0 12px">勾起來之後，「串流」分頁預設就只看這些平台。之後在片單上臨時改篩選，不會動到這裡。</p>' +
      '<div class="pfwrap" id="mysubs">' + mysubsChips(k.mysubs || []) + "</div></div>" +

      '<div class="card step"><h3>資料快取</h3>' +
      '<p class="sub" style="margin:0 0 10px" id="cachestat"></p>' +
      '<button class="btn wide" type="button" id="clearCache">清掉快取，重新抓資料</button></div>' +

      '<p class="foot">好雷嗎? v' + C.ver + "<br>資料來源 TMDB / OMDb。這個 App 只查評價，不導購。</p>" +
      "</div>";
  }

  function testRow(state, label, msg) {
    var cls = state === true ? "ok" : (state === false ? "ng" : "wait");
    var mark = state === true ? "✓" : (state === false ? "✗" : "…");
    return '<div class="tr ' + cls + '"><span class="m">' + mark + "</span><span><b>" + esc(label) + "</b>　" + esc(msg) + "</span></div>";
  }

  return {
    esc: esc, fmtVotes: fmtVotes, fmtTime: fmtTime, toneColor: toneColor, toneWord: toneWord,
    aggregate: aggregate, posterHTML: posterHTML, tmdbPill: tmdbPill, votesHTML: votesHTML,
    dotsHTML: dotsHTML, rowHTML: rowHTML, metaHTML: metaHTML, skeletonRows: skeletonRows,
    emptyPf: emptyPf, emptySearch: emptySearch, emptyList: emptyList, errorBox: errorBox,
    detailHTML: detailHTML, detailSkeleton: detailSkeleton,
    pttHTML: pttHTML, pttVerdict: pttVerdict, pttSegs: pttSegs, pttPicks: pttPicks,
    pttTitle: pttTitle, pttStamp: pttStamp, pttStaleDays: pttStaleDays,
    setupHTML: setupHTML, testRow: testRow, mysubsChips: mysubsChips,
    keyFormHTML: keyFormHTML, keyErrorHTML: keyErrorHTML,
    fmtDateLong: fmtDateLong, fmtMD: fmtMD, daysSinceRelease: daysSinceRelease
  };
})();

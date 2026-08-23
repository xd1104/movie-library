/* 好雷嗎? — PTT 電影板解析與片名比對（純函式，不碰網路、不碰檔案）
   ------------------------------------------------------------------
   ⚠️ 這支檔案是「所有跟 PTT 網頁結構有關的假設」的**唯一集中地**。
   PTT 改版時，要修的地方只有這裡（尤其是下面的 SELECTORS）。
   scripts/fetch-ptt.mjs 只負責抓網頁與輸出檔案，不可以自己另外寫 HTML 解析。

   ⚠️ 開發環境連不到 www.ptt.cc（出口被擋），底下的結構假設**全部憑既有知識寫的**，
      沒有對著真實網頁驗證過。驗證只發生在 GitHub Actions 第一次跑的時候。
      所以 fetch-ptt.mjs 有「抓到 0 篇就讓 Actions 失敗並印診斷」的死規定，不可以拿掉。 */

/* ========== A. PTT 網頁結構假設（改版就改這裡） ========== */
export const SELECTORS = {
  /* A1. 一篇文章一個 <div class="r-ent">。用 exec 掃出每個起始位置，
         再切成一段一段處理（不能只用 split，因為要知道每篇在原始 HTML 的位置，
         才判斷得出它在 r-list-sep 之前還是之後）。 */
  entry: /<div class="[^"]*\br-ent\b[^"]*"\s*>/g,

  /* A2. <div class="r-list-sep"> 之後的都是「置底文」（板規、公告），一律不收。 */
  sep: /<div class="[^"]*\br-list-sep\b[^"]*"/,

  /* A3. 標題區塊。⚠️ 一定要先框出 <div class="title">，再從裡面取 <a>——
         r-ent 裡面還有一個 <div class="article-menu"> 下拉選單，那裡面也有一堆 <a>
         （搜尋同標題文章、搜尋看板…）。直接抓 r-ent 裡「第一個 a」會抓錯。 */
  titleBlock: /<div class="title">([\s\S]*?)<\/div>/,
  titleLink: /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,

  /* A4. 推文數。0 推時整個 <span> 不存在（<div class="nrec"></div>）。
         內容可能是數字、「爆」、「X1」～「XX」。 */
  nrec: /<div class="nrec">([\s\S]*?)<\/div>/,

  /* A5. 日期，格式是 M/DD（前面可能有半形空白，例如 " 8/20"）。沒有年份。
         → 真正用來判斷新舊的是文章網址裡的 unix 時間戳（見 postTimeFromUrl），
           這個欄位只拿來顯示。 */
  date: /<div class="date">([\s\S]*?)<\/div>/,

  /* A6. 作者。被刪除的文章這裡是 "-"。 */
  author: /<div class="author">([\s\S]*?)<\/div>/,

  /* A7. 翻頁按鈕：<a class="btn wide" href="/bbs/movie/index3943.html">&lsaquo; 上頁</a>
         「上頁」＝比較舊的一頁（PTT 的 index 編號是越舊越小）。
         屬性順序不保證，所以先掃出所有 <a>，再挑內文含「上頁」而且有 href 的。 */
  anchor: /<a\s+([^>]*)>([\s\S]*?)<\/a>/g,
  hrefAttr: /href="([^"]+)"/,

  /* A8. 年齡確認頁（PTT 對某些板會 302 到 /ask/over18）。
         電影板照理說不用，但這條是防呆——偵測到就帶 over18=1 cookie 重試。 */
  ageGate: /over18-notice|\/ask\/over18|未滿十八歲|18\s*歲以下/
};

/* PTT 站台根網址（組相對連結用）。 */
export const PTT_ORIGIN = "https://www.ptt.cc";

/* ========== B. 小工具 ========== */

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** 去 HTML 標籤 + 解實體 + 收斂空白 */
export function textOf(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, m => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ")
    .trim();
}

/** 全形轉半形（含全形空白），給後續正規化用 */
export function toHalf(s) {
  return String(s == null ? "" : s)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ");
}

/** 推文數：數字 / 「爆」/「X1」～「XX」。爆＝100（PTT 破百就只顯示爆，拿不到真實數字）。 */
export function parsePush(raw) {
  const t = toHalf(textOf(raw)).trim();
  if (!t) return 0;
  if (t === "爆") return 100;
  if (/^XX$/i.test(t)) return -100;
  const x = /^X(\d+)$/i.exec(t);
  if (x) return -10 * Number(x[1]);
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** 文章網址裡的 unix 秒數：/bbs/movie/M.1755600000.A.1A2.html → 毫秒。拿不到回 null。 */
export function postTimeFromUrl(url) {
  const m = /\/M\.(\d{9,11})\.A\./.exec(String(url || ""));
  return m ? Number(m[1]) * 1000 : null;
}

/** 相對連結補成絕對網址 */
export function absUrl(href) {
  const h = String(href || "");
  if (/^https?:\/\//.test(h)) return h;
  return PTT_ORIGIN + (h.startsWith("/") ? h : "/" + h);
}

/* ========== C. 標籤與排除規則 ========== */

/* 只收這三種。其他（[請益][討論][新聞][片單][無雷][公告]…）一律略過。 */
export const TAGS = { 好雷: "good", 普雷: "ok", 負雷: "bad" };

/** 回文／轉錄／公告要排除，回傳排除原因（沒有就 null）。
    - Re:  回文的標籤是**沿用原文的**，不是回文者自己的評價，算進去會重複計票。
    - Fw:／[轉錄] 同理，那是別板搬過來的。 */
export function skipReason(title) {
  const t = toHalf(title).trim();
  if (/^re\s*[:：]/i.test(t)) return "reply";
  if (/^fw\s*[:：]/i.test(t)) return "forward";
  if (/^\[\s*轉錄/.test(t) || /^\[\s*公告/.test(t) || /^\[\s*板規/.test(t)) return "notice";
  if (/^\(本文已被刪除\)|^\[本文已被刪除\]/.test(t)) return "deleted";
  return null;
}

/** 取雷標籤：必須在標題**最前面**。
    容忍 [ 好雷]、[好 雷]、［好雷］（全形），但不收 [微好雷]／[無雷] 這種變體（寧可漏抓）。
    回傳 "好雷" / "普雷" / "負雷" 或 null。 */
export function parseTag(title) {
  const m = /^\[\s*([好普負])\s*雷\s*\]/.exec(toHalf(title).trim());
  return m ? m[1] + "雷" : null;
}

/** 把開頭的 [xx雷] 拿掉，剩下的才拿去比對片名 */
export function stripTag(title) {
  return toHalf(title).trim().replace(/^\[\s*[好普負]\s*雷\s*\]/, "").trim();
}

/* ========== D. 列表頁解析 ========== */

/** 這頁是不是年齡確認頁 */
export function isAgeGate(html) {
  return SELECTORS.ageGate.test(String(html || ""));
}

/** 取「上頁」（比較舊的一頁）的網址；沒有回 null */
export function prevPageUrl(html) {
  const re = new RegExp(SELECTORS.anchor.source, "g");
  let m;
  while ((m = re.exec(String(html || "")))) {
    if (!/上頁/.test(textOf(m[2]))) continue;
    const h = SELECTORS.hrefAttr.exec(m[1]);
    if (h) return absUrl(h[1]);
  }
  return null;
}

/**
 * 解析一頁列表。
 * 回傳 { posts, prevUrl, raw, skipped }
 *   posts   : [{ title, url, date, push, author, time }]（已排除刪除文、置底文）
 *   raw     : 這頁掃到幾個 r-ent（含被排除的）——0 就代表結構可能變了
 *   skipped : { deleted, pinned }
 */
export function parseListPage(html) {
  const src = String(html || "");
  const sepM = SELECTORS.sep.exec(src);
  const sepAt = sepM ? sepM.index : Infinity;

  const starts = [];
  const re = new RegExp(SELECTORS.entry.source, "g");
  let m;
  while ((m = re.exec(src))) starts.push(m.index);

  const posts = [];
  const skipped = { deleted: 0, pinned: 0 };

  for (let i = 0; i < starts.length; i++) {
    const chunk = src.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : src.length);
    if (starts[i] > sepAt) { skipped.pinned++; continue; }   /* 置底文不收 */

    const tb = SELECTORS.titleBlock.exec(chunk);
    if (!tb) { skipped.deleted++; continue; }
    const link = SELECTORS.titleLink.exec(tb[1]);
    if (!link) { skipped.deleted++; continue; }              /* 沒有 <a> ＝ 已被刪除 */

    const url = absUrl(link[1]);
    const nrec = SELECTORS.nrec.exec(chunk);
    const date = SELECTORS.date.exec(chunk);
    const author = SELECTORS.author.exec(chunk);

    posts.push({
      title: textOf(link[2]),
      url,
      date: date ? textOf(date[1]) : "",
      push: parsePush(nrec ? nrec[1] : ""),
      author: author ? textOf(author[1]) : "",
      time: postTimeFromUrl(url)
    });
  }
  return { posts, prevUrl: prevPageUrl(src), raw: starts.length, skipped };
}

/* ========== E. 片名比對 ==========
   原則（PM 定的）：**寧可漏抓不要錯配**。錯配＝這部片的評價其實是別部片的，比沒有更糟。
   所以每一條規則都往保守的方向設，最後還有「兩部片打平就都不要」的歧義守衛。 */

export const MATCH = {
  CJK_MIN: 2,        /* 中文別名至少 2 個字 */
  SHORT_CJK_MAX: 3,  /* 2～3 字的短片名太容易誤中，必須出現在標題前段 */
  HEAD_CHARS: 10,    /* 「前段」＝正規化後前 10 個字 */
  LATIN_MIN: 5,      /* 英文別名至少 5 個字母（"dune"、"her"、"up" 這種太短，一律不用） */
  MAX_POSTS: 8       /* 每部片最多留 8 則（檔案會被使用者下載，不能無限長） */
};

/** 緊縮正規化：全形→半形、轉小寫、只留文字與數字（空白、標點、冒號全部丟掉） */
export function normTight(s) {
  return toHalf(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 鬆散正規化：保留單一空白，給英文片名做「整個單字」比對用 */
export function normLoose(s) {
  return toHalf(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const CN_NUM = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };

/** 產生一個片名的所有別名（未正規化）。鄉民會用簡稱，這裡就是在猜那些簡稱。 */
export function aliasVariants(name) {
  const base = toHalf(name).trim();
  if (!base) return [];
  const out = new Set([base]);

  /* 1) 冒號前那段：「沙丘：第二部」→「沙丘」 */
  const colon = base.split(/[:：]/)[0].trim();
  if (colon && colon !== base) out.add(colon);

  /* 2) 中文數字集數 →阿拉伯數字：「沙丘：第二部」→「沙丘2」、「第三集」→「3」 */
  for (const v of [...out]) {
    const n = v.replace(/第\s*([一二三四五六七八九十])\s*(部|集|季|章)/g, (_, c) => CN_NUM[c])
               .replace(/第\s*(\d+)\s*(部|集|季|章)/g, "$1");
    if (n !== v) out.add(n);
  }

  /* 3) 英文序數／羅馬數字：「Dune: Part Two」→「dune 2」 */
  for (const v of [...out]) {
    const n = v.replace(/\bpart\s+(one|two|three|four)\b/gi,
                        (_, w) => ({ one: "1", two: "2", three: "3", four: "4" })[w.toLowerCase()])
               .replace(/\b(iii|ii|iv)\b/gi, w => ({ ii: "2", iii: "3", iv: "4" })[w.toLowerCase()]);
    if (n !== v) out.add(n);
  }
  return [...out];
}

/** 一部片 → 可用的別名清單（已正規化、已過濾掉太短的） */
export function aliasesFor(movie) {
  const names = [movie.title, movie.original_title].filter(Boolean);
  const seen = new Set();
  const list = [];
  for (const nm of names) {
    for (const v of aliasVariants(nm)) {
      const tight = normTight(v);
      const loose = normLoose(v);
      if (!tight || seen.has(tight)) continue;
      const latin = /^[a-z0-9 ]+$/.test(loose) && /[a-z]/.test(loose);
      if (latin ? tight.length < MATCH.LATIN_MIN : tight.length < MATCH.CJK_MIN) continue;
      seen.add(tight);
      list.push({ tight, loose, latin });
    }
  }
  return list;
}

/** 片單 → 比對索引 */
export function buildIndex(movies) {
  return (movies || [])
    .filter(m => m && m.id != null)
    .map(m => ({ id: String(m.id), title: m.title || m.original_title || "", aliases: aliasesFor(m) }))
    .filter(m => m.aliases.length > 0);
}

function latinHit(loose, alias) {
  const a = alias.loose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^| )" + a + "( |$)").test(loose);
}

/**
 * 把一則文章標題比對到片單裡的某部片。
 * 回傳 { id, alias, score } 或 { id: null, reason }
 *   reason: "none"（沒有任何片名命中）／"ambiguous"（兩部以上打平，寧可不配）
 */
export function matchTitle(titleNoTag, index) {
  const tight = normTight(titleNoTag);
  const loose = normLoose(titleNoTag);
  if (!tight) return { id: null, reason: "none" };

  const hits = [];
  for (const mv of index) {
    let best = null;
    for (const a of mv.aliases) {
      let ok = false;
      if (a.latin) {
        ok = latinHit(loose, a);
      } else {
        const pos = tight.indexOf(a.tight);
        /* 短片名（2～3 字）只認「出現在標題前段」的，不然「怪物」這種兩字片名到處都中 */
        ok = pos >= 0 && (a.tight.length > MATCH.SHORT_CJK_MAX || pos <= MATCH.HEAD_CHARS);
      }
      if (ok && (!best || a.tight.length > best.len)) best = { len: a.tight.length, alias: a.tight };
    }
    if (best) hits.push({ id: mv.id, score: best.len, alias: best.alias });
  }
  if (!hits.length) return { id: null, reason: "none" };

  hits.sort((a, b) => b.score - a.score);
  /* 歧義守衛：最高分有兩部以上不同的片 → 寧可不配。
     例：片單同時有「沙丘」與「沙丘：第二部」，標題只寫「沙丘」時兩邊都只命中 2 個字。 */
  if (hits.length > 1 && hits[1].score === hits[0].score && hits[1].id !== hits[0].id) {
    return { id: null, reason: "ambiguous" };
  }
  return { id: hits[0].id, alias: hits[0].alias, score: hits[0].score };
}

/* ========== F. 產出 JSON ========== */

/**
 * 組出 data/ptt-movie.json 的內容。
 * entries: [{ movieId, tag, title, url, date, push }]
 * scanned: { pages, posts, matched, unmatched }
 * ⚠️ 格式是 PM 定死的契約，欄位不要自己加減（lab-ux 那邊用同一份）。
 */
export function buildPayload({ entries, scanned, source, updated }) {
  const movies = {};
  for (const e of entries || []) {
    const id = String(e.movieId);
    if (!movies[id]) movies[id] = { good: 0, ok: 0, bad: 0, posts: [] };
    const slot = TAGS[e.tag];
    if (!slot) continue;
    movies[id][slot]++;                       /* 計數用全部的文章，不是只用留下來那 8 則 */
    movies[id].posts.push({
      tag: e.tag, title: e.title, url: e.url, date: e.date || "", push: e.push || 0
    });
  }
  /* 依推文數由高到低；同分用網址（＝發文時間）由新到舊，讓每天產出的順序穩定，
     不然順序抖動會每天都產生一個「其實沒變」的 commit。 */
  const out = {};
  for (const id of Object.keys(movies).sort((a, b) => Number(a) - Number(b))) {
    const m = movies[id];
    m.posts.sort((x, y) => (y.push - x.push) || (x.url < y.url ? 1 : x.url > y.url ? -1 : 0));
    m.posts = m.posts.slice(0, MATCH.MAX_POSTS);
    out[id] = m;
  }
  return {
    updated: updated || new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source,
    scanned: {
      pages: scanned.pages | 0, posts: scanned.posts | 0,
      matched: scanned.matched | 0, unmatched: scanned.unmatched | 0
    },
    movies: out
  };
}

/* ========== G. 健康檢查（死規定） ==========
   安靜產出一份空的 JSON ＝ App 上顯示「沒有討論」＝ 沒有人知道爬蟲死了。
   所以下面任何一條成立，fetch-ptt.mjs 就要讓 Actions 失敗並印診斷。
   ⚠️ 不要為了「讓 workflow 綠一點」放寬這裡。 */
export function healthCheck(st) {
  const bad = [];
  if (!st.pages) bad.push("一頁都沒抓到");
  if (!st.catalog) bad.push("TMDB 片單 0 部（拿不到片單的話全部都會比對不到）");
  if (!st.posts) bad.push("整輪掃下來 0 篇文章 —— PTT 版面結構可能變了（見 SELECTORS）");
  else if (!st.tagged) bad.push("有文章但 0 篇帶得到雷標籤 —— 標籤寫法可能變了（見 parseTag）");
  if (st.pages && st.emptyPages >= Math.max(2, Math.ceil(st.pages / 2))) {
    bad.push("有 " + st.emptyPages + " / " + st.pages + " 頁解析不到任何文章");
  }
  return bad;
}

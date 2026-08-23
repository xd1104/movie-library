/* 好雷嗎? — 抓 PTT 電影板的鄉民評價，產出 data/ptt-movie.json
   ------------------------------------------------------------------
   在 GitHub Actions 上跑（.github/workflows/ptt.yml），每天一次。
   純 Node、零依賴（不要為了解析 HTML 裝 cheerio，解析全在 scripts/ptt-parse.mjs）。

   用法：
     node scripts/fetch-ptt.mjs                      正式跑（要 TMDB_KEY）
     node scripts/fetch-ptt.mjs --offline            不連網，用 test/fixtures 的假資料跑完整流程
     node scripts/fetch-ptt.mjs --offline --fixtures=<資料夾>   用別的假資料（驗「壞掉會不會吵」用）
     node scripts/fetch-ptt.mjs --pages=3 --out=x.json

   ⚠️ 死規定（不可以拿掉，PM 明訂）：
      抓到 0 篇文章、或 0 篇帶得到雷標籤 → **讓 Actions 失敗**並印出診斷
      （URL、HTTP 狀態、HTML 前 500 字）。安靜產出一份空 JSON 的話，
      App 上只會顯示「PTT 上沒找到討論」，沒有人會知道爬蟲已經死了。

   ⚠️ 金鑰：TMDB 金鑰從 process.env.TMDB_KEY 讀（GitHub Actions secret）。
      所有輸出都要經過 log()／redact()，避免金鑰被印進 Actions 紀錄。 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import {
  parseListPage, isAgeGate, parseTag, stripTag, skipReason,
  buildIndex, matchTitle, buildPayload, healthCheck, PTT_ORIGIN
} from "./ptt-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ========== 可調參數 ========== */
export const CFG = {
  board: "movie",
  index: PTT_ORIGIN + "/bbs/movie/index.html",
  maxPages: 40,          /* 最多翻幾頁（PTT 一頁 20 篇 → 約 800 篇） */
  daysBack: 90,          /* 只收最近三個月的文；跟 maxPages 取先到的那個 */
  sleepMs: 700,          /* 每次請求之間至少睡這麼久——這是別人的免費服務，不要轟炸 */
  timeoutMs: 15000,
  retries: 2,
  catalogPages: 1,       /* TMDB 片單抓幾頁（一頁 20 部，跟 App 顯示的範圍一致） */
  /* ⚠️ HTTP header 只能放 latin-1，這裡**不可以有中文**——
     放了中文的話 fetch 會直接丟 ByteString 例外，每一個請求都炸掉（2026-08-23 踩過）。 */
  ua: "Mozilla/5.0 (compatible; hao-lei-ma-bot/1.0; personal use, once a day)",
  outFile: "data/ptt-movie.json"
};

/* ========== 記錄輸出（一律先遮金鑰） ========== */
const SECRETS = [];
export function redact(s) {
  let t = String(s == null ? "" : s);
  for (const k of SECRETS) if (k && k.length >= 6) t = t.split(k).join("***");
  return t.replace(/api_key=[^&\s"']+/gi, "api_key=***");
}
const log = (...a) => console.log(a.map(redact).join(" "));
const warn = (...a) => console.log("⚠️  " + a.map(redact).join(" "));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ========== HTTP ========== */
async function httpGet(url, { cookie } = {}) {
  const headers = {
    "User-Agent": CFG.ua,
    "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9"
  };
  if (cookie) headers.Cookie = cookie;
  let last = null;
  for (let i = 0; i <= CFG.retries; i++) {
    if (i) { warn("第 " + i + " 次重試：" + url); await sleep(CFG.sleepMs * (i + 1)); }
    try {
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(CFG.timeoutMs) });
      const body = await res.text();
      if (res.status >= 500) { last = { status: res.status, body, url: res.url || url }; continue; }
      return { status: res.status, body, url: res.url || url };
    } catch (e) {
      last = { status: 0, body: "", url, error: redact(e && e.message) };
    }
  }
  return last || { status: 0, body: "", url };
}

/** 印診斷：出事的時候，看紀錄的人要能一眼看出是哪一步、拿到什麼 */
function diag(label, r) {
  console.log("");
  console.log("──────── 診斷：" + label + " ────────");
  console.log("  URL        : " + redact(r && r.url));
  console.log("  HTTP 狀態  : " + (r ? r.status : "(沒有回應)") + (r && r.error ? "  錯誤：" + r.error : ""));
  console.log("  回應長度   : " + (r && r.body ? r.body.length : 0) + " 字元");
  console.log("  HTML 前 500 字：");
  console.log("  " + redact((r && r.body ? r.body : "(空)").slice(0, 500)).replace(/\n/g, "\n  "));
  console.log("────────────────────────────────");
  console.log("");
}

/* ========== PTT ========== */
/** 抓一頁列表；碰到年齡確認頁就帶 over18 cookie 重試一次 */
export async function getListPage(url, state) {
  let r = await httpGet(url, { cookie: state.cookie });
  if (r.status === 200 && isAgeGate(r.body)) {
    warn("被導到年齡確認頁（電影板照理說不用，但還是處理了）→ 帶 over18=1 cookie 重試：" + url);
    state.cookie = "over18=1";
    await sleep(CFG.sleepMs);
    r = await httpGet(url, { cookie: state.cookie });
    if (r.status === 200 && !isAgeGate(r.body)) log("   ↳ 帶 cookie 後過了");
  }
  return r;
}

/* ========== 把文章分類（純函式，好測） ========== */
/**
 * pages: [{ url, posts }]（已經解析好的每一頁）
 * index: buildIndex(片單)
 * 回傳 { entries, stats }
 */
export function collectEntries(pages, index, { cutoffTime = 0 } = {}) {
  const entries = [];
  const stats = {
    pages: pages.length, posts: 0, tagged: 0, matched: 0, unmatched: 0,
    tooOld: 0, ambiguous: 0, emptyPages: 0,
    skipped: { reply: 0, forward: 0, notice: 0, deleted: 0 },
    tiebroken: { cinema: 0, popularity: 0, release: 0 },
    samples: { ambiguous: [], none: [], tiebroken: [] }
  };
  for (const pg of pages) {
    if (!pg.posts.length) stats.emptyPages++;
    for (const p of pg.posts) {
      stats.posts++;
      if (cutoffTime && p.time && p.time < cutoffTime) { stats.tooOld++; continue; }
      const sk = skipReason(p.title);
      if (sk) { stats.skipped[sk] = (stats.skipped[sk] || 0) + 1; continue; }
      const tag = parseTag(p.title);
      if (!tag) continue;                 /* [請益][討論][新聞]… 一律略過 */
      stats.tagged++;
      const hit = matchTitle(stripTag(p.title), index);
      if (!hit.id) {
        /* ambiguous（同名破平失敗）與 unmatched（根本沒命中）**分開記**，
           不然看不出破平規則有沒有效（PM 2026-08-23 要求）。 */
        if (hit.reason === "ambiguous") {
          stats.ambiguous++;
          if (stats.samples.ambiguous.length < 5) stats.samples.ambiguous.push(p.title);
        } else {
          stats.unmatched++;
          if (stats.samples.none.length < 5) stats.samples.none.push(p.title);
        }
        continue;
      }
      stats.matched++;
      if (hit.how && hit.how !== "unique") {
        stats.tiebroken[hit.how] = (stats.tiebroken[hit.how] || 0) + 1;
        if (stats.samples.tiebroken.length < 5) stats.samples.tiebroken.push(p.title + "　→ " + hit.alias + "（靠" +
          ({ cinema: "現正上映", popularity: "熱門度", release: "上映日" })[hit.how] + "破平）");
      }
      entries.push({ movieId: hit.id, tag, title: p.title, url: p.url, date: p.date, push: p.push });
    }
  }
  return { entries, stats };
}

/* ========== TMDB 片單 ========== */
/** 從 js/config.js 讀平台字典，避免片單範圍跟 App 兩邊各寫一份 */
function filterableProviderIds() {
  try {
    const src = readFileSync(join(ROOT, "js/config.js"), "utf8");
    const sandbox = {};
    new Function("with(this){" + src + "; this.__b=HLM_BRAND; this.__f=HLM_FILTERABLE;}").call(sandbox);
    return sandbox.__f.map(k => sandbox.__b[k] && sandbox.__b[k].id).filter(Boolean);
  } catch (e) {
    warn("讀不到 js/config.js 的平台字典，串流片單改成「台灣所有訂閱制」：" + redact(e.message));
    return [];
  }
}

async function tmdbJSON(path, params, key) {
  const q = new URLSearchParams({ ...params, api_key: key }).toString();
  const r = await httpGet("https://api.themoviedb.org/3" + path + "?" + q);
  if (r.status !== 200) {
    /* ⚠️ 這裡只印 path，不印帶了 api_key 的完整 URL */
    throw new Error("TMDB " + path + " 回 HTTP " + r.status +
      (r.status === 401 ? "（金鑰不對？secret TMDB_KEY 要放 API Key v3 auth 那組）" : "") +
      (r.error ? "，錯誤：" + redact(r.error) : ""));
  }
  try { return JSON.parse(r.body); }
  catch (e) { throw new Error("TMDB " + path + " 回的不是 JSON"); }
}

/** 電影院上映中 ＋ 台灣訂閱制串流片單（跟 App 顯示的範圍一致） */
export async function tmdbCatalog(key) {
  const ids = filterableProviderIds();
  const out = new Map();
  /* inCinema 是同名破平的第一順位（鄉民在電影板講的幾乎都是現正上映的片），
     所以 now_playing 來的要標記，而且不可以被後面 discover 的同一部片洗掉。 */
  const add = (j, inCinema) => (j.results || []).forEach(m => {
    if (!m || !m.id) return;
    const k = String(m.id), old = out.get(k);
    out.set(k, {
      id: m.id, title: m.title, original_title: m.original_title,
      popularity: Number(m.popularity) || 0, release_date: m.release_date || "",
      inCinema: inCinema || !!(old && old.inCinema)
    });
  });
  for (let page = 1; page <= CFG.catalogPages; page++) {
    add(await tmdbJSON("/movie/now_playing", { region: "TW", language: "zh-TW", page }, key), true);
    await sleep(200);
    add(await tmdbJSON("/discover/movie", {
      watch_region: "TW", language: "zh-TW",
      with_watch_monetization_types: "flatrate",
      with_watch_providers: ids.join("|"),
      sort_by: "popularity.desc", include_adult: false, page
    }, key), false);
    await sleep(200);
  }
  return [...out.values()];
}

/* ========== 只有內容真的變了才寫檔 ========== */
/** 比對兩份 payload，忽略 updated（不然每天都會產生一個「其實沒變」的 commit） */
export function payloadEquals(a, b) {
  if (!a || !b) return false;
  const strip = o => JSON.stringify({ source: o.source, scanned: o.scanned, movies: o.movies });
  return strip(a) === strip(b);
}

export function writeIfChanged(file, payload) {
  let old = null;
  if (existsSync(file)) { try { old = JSON.parse(readFileSync(file, "utf8")); } catch (e) { old = null; } }
  if (payloadEquals(old, payload)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return true;
}

/* ========== 主流程 ========== */
export async function main(argv) {
  const arg = n => (argv.find(a => a.startsWith("--" + n + "=")) || "").split("=").slice(1).join("=");
  const offline = argv.includes("--offline");
  const maxPages = Number(arg("pages")) || CFG.maxPages;
  const outArg = arg("out") || CFG.outFile;
  const outFile = isAbsolute(outArg) ? outArg : join(ROOT, outArg);

  const t0 = Date.now();
  log("好雷嗎? — PTT 電影板鄉民評價");
  log("開始時間：" + new Date().toISOString() + (offline ? "　（--offline：用假資料跑，不連網）" : ""));
  log("設定：最多 " + maxPages + " 頁、最近 " + CFG.daysBack + " 天、每次請求間隔 " + CFG.sleepMs + "ms");

  /* ---- 1. 片單 ---- */
  let catalog = [];
  const fxDir = arg("fixtures") || join(ROOT, "test/fixtures");
  if (offline) {
    catalog = JSON.parse(readFileSync(join(fxDir, "tmdb-catalog.json"), "utf8")).movies;
  } else {
    const key = process.env.TMDB_KEY || "";
    if (!key) {
      console.log("❌ 沒有 TMDB_KEY。請到 repo → Settings → Secrets and variables → Actions");
      console.log("   新增一個名叫 TMDB_KEY 的 secret（TMDB 的 API Key v3 auth，32 碼那組）。");
      return 1;
    }
    SECRETS.push(key);
    try {
      catalog = await tmdbCatalog(key);
    } catch (e) {
      console.log("❌ 抓 TMDB 片單失敗：" + redact(e.message));
      console.log("   片單抓不到的話，所有 PTT 文章都會比對不到片，等於整輪白跑。");
      return 1;
    }
  }
  log("片單：" + catalog.length + " 部（電影院 now_playing ＋ 台灣訂閱制 discover）");
  const index = buildIndex(catalog);
  log("比對索引：" + index.length + " 部片、" + index.reduce((n, m) => n + m.aliases.length, 0) + " 個別名");

  /* ---- 2. 爬 PTT ---- */
  const cutoffTime = Date.now() - CFG.daysBack * 86400e3;
  const pages = [];
  let foreign = 0;                 /* 連結不是 ptt.cc 而被丟掉的文章數（正常應該一直是 0） */
  let stopReason = "抓滿 " + maxPages + " 頁";

  if (offline) {
    for (const f of readdirSync(fxDir).filter(n => /^ptt-list-.*\.html$/.test(n)).sort()) {
      const html = readFileSync(join(fxDir, f), "utf8");
      const r = parseListPage(html);
      foreign += r.skipped.foreign;
      pages.push({ url: "fixture:" + f, posts: r.posts, raw: r.raw, head: html.slice(0, 1000) });
      log("  " + f + "：" + r.posts.length + " 篇");
    }
    stopReason = "假資料跑完";
  } else {
    const state = { cookie: "" };
    let url = CFG.index;
    for (let i = 0; i < maxPages; i++) {
      if (i) await sleep(CFG.sleepMs);
      const r = await getListPage(url, state);
      if (r.status !== 200) {
        console.log("❌ 抓 PTT 列表頁失敗（第 " + (i + 1) + " 頁）");
        diag("PTT 列表頁 HTTP " + r.status, r);
        if (i === 0) return 1;                 /* 第一頁就掛＝整輪沒意義 */
        warn("已經抓到 " + pages.length + " 頁，就用這些繼續");
        stopReason = "第 " + (i + 1) + " 頁 HTTP " + r.status + " 提早停";
        break;
      }
      if (isAgeGate(r.body)) {
        console.log("❌ 帶了 over18 cookie 還是被年齡確認頁擋住");
        diag("年齡確認頁", r);
        return 1;
      }
      const parsed = parseListPage(r.body);
      /* 只留前 1000 字，出事時的診斷要印得出來（整份 HTML 留著會吃記憶體） */
      foreign += parsed.skipped.foreign;
      pages.push({ url, posts: parsed.posts, raw: parsed.raw, head: r.body.slice(0, 1000) });
      log("  [" + (i + 1) + "/" + maxPages + "] " + url.replace(PTT_ORIGIN + "/bbs/" + CFG.board + "/", "") +
        " → " + parsed.posts.length + " 篇" +
        (parsed.skipped.deleted ? "（刪除 " + parsed.skipped.deleted + "）" : "") +
        (parsed.skipped.pinned ? "（置底 " + parsed.skipped.pinned + "）" : ""));

      if (parsed.raw === 0) {
        warn("這一頁一個 r-ent 都沒解析到 —— 版面可能變了");
        if (i === 0) diag("第一頁解析不到任何文章", r);
      }
      const oldest = parsed.posts.reduce((a, p) => (p.time && (!a || p.time < a) ? p.time : a), null);
      if (oldest && oldest < cutoffTime) { stopReason = "翻到 " + CFG.daysBack + " 天以前了"; break; }
      if (!parsed.prevUrl) { stopReason = "沒有「上頁」連結了"; break; }
      url = parsed.prevUrl;
    }
  }

  /* ---- 3. 分類與比對 ---- */
  const { entries, stats } = collectEntries(pages, index, { cutoffTime });
  stats.catalog = catalog.length;

  /* ---- 4. 健康檢查（死規定） ---- */
  const problems = healthCheck(stats);
  if (problems.length) {
    console.log("");
    console.log("❌ 爬蟲看起來壞了，這次不產出檔案：");
    for (const p of problems) console.log("   - " + p);
    console.log("");
    console.log("   要看的地方：scripts/ptt-parse.mjs 的 SELECTORS（HTML 結構假設全在那裡）");
    const lastPage = pages[pages.length - 1];
    diag("最後一頁的原始回應", { url: lastPage ? lastPage.url : CFG.index, status: 200, body: (lastPage && lastPage.head) || "(沒留下 HTML)" });
    return 1;
  }

  /* ---- 5. 產出 ---- */
  const payload = buildPayload({
    entries,
    scanned: {
      pages: stats.pages, posts: stats.posts, tagged: stats.tagged,
      matched: stats.matched, ambiguous: stats.ambiguous, unmatched: stats.unmatched
    },
    source: CFG.index
  });
  const changed = writeIfChanged(outFile, payload);

  /* ---- 6. 給 PM 看的摘要 ---- */
  const nMovies = Object.keys(payload.movies).length;
  console.log("");
  console.log("──────── 這一輪的結果 ────────");
  console.log("  停止原因      : " + stopReason);
  console.log("  抓了幾頁      : " + stats.pages + "（其中 " + stats.emptyPages + " 頁解析不到文章）");
  console.log("  掃到文章      : " + stats.posts + " 篇");
  console.log("    ├ 太舊略過  : " + stats.tooOld);
  console.log("    ├ 回文/轉錄 : " + (stats.skipped.reply + stats.skipped.forward + stats.skipped.notice));
  console.log("    └ 有雷標籤  : " + stats.tagged);
  if (foreign) {
    console.log("  ⚠️ 連結不是 ptt.cc : " + foreign + " 篇（整篇丟掉）—— 正常應該是 0，");
    console.log("     不是 0 的話去看 SELECTORS.titleLink 抓到了什麼，別讓外站連結進資料檔");
  }
  console.log("  比對到片      : " + stats.matched + " 篇 → " + nMovies + " 部片");
  console.log("    └ 同名破平  : " + (stats.tiebroken.cinema + stats.tiebroken.popularity + stats.tiebroken.release) +
    " 篇（現正上映 " + stats.tiebroken.cinema + "／熱門度 " + stats.tiebroken.popularity + "／上映日 " + stats.tiebroken.release + "）");
  console.log("  歧義放棄      : " + stats.ambiguous + " 篇（破平也分不出來）");
  console.log("  沒比對到      : " + stats.unmatched + " 篇（片單以外的片，正常）");
  console.log("  比對率        : " + (stats.tagged ? Math.round(stats.matched / stats.tagged * 100) : 0) + "%");
  console.log("  檔案          : " + outFile.replace(ROOT + "/", "") + (changed ? "　（有變動，會 commit）" : "　（內容沒變，不動它）"));
  console.log("  花了          : " + Math.round((Date.now() - t0) / 1000) + " 秒");
  if (stats.samples.tiebroken.length) {
    console.log("  同名破平的例子（確認有沒有配錯片，這是最該人工看一眼的地方）：");
    for (const t of stats.samples.tiebroken) console.log("    · " + t);
  }
  if (stats.samples.ambiguous.length) {
    console.log("  歧義放棄的例子（破平也分不出來，寧可漏抓不要錯配）：");
    for (const t of stats.samples.ambiguous) console.log("    · " + t);
  }
  if (stats.samples.none.length) {
    console.log("  比對不到的例子（多半是片單以外的片，正常）：");
    for (const t of stats.samples.none) console.log("    · " + t);
  }
  console.log("──────────────────────────────");
  return 0;
}

/* 只有被直接執行時才跑 main（測試要 import 這支檔案） */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => {
    console.log("❌ 沒接到的例外：" + redact(e && e.stack || e));
    process.exit(1);
  });
}

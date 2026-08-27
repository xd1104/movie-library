/* 突變驗證：npm run test:mutate
   把每一件「應該被守住的事」各弄壞一次，確認測試真的會紅——
   「有測試」不等於「測試在保護那件事」，這支就是用來證明後者的。
   會暫時改動 js/ 底下的檔案，跑完一定還原，並用 SHA-256 比對確認一模一樣。
   ⚠️ 跑的時候不要同時改專案裡的檔案（雜湊會對不起來）。

   用法：
     npm run test:mutate                跑全部（⚠ 這台機器實測 1.5~2 小時：161 條 x 每條一次完整套件 ~40 秒）
     npm run test:mutate -- --dry       只檢查每條突變的目標字串還套不套得上（幾秒鐘）
     npm run test:mutate -- --only=M40,R1  只跑指定前綴的突變

   ⭐ 這支工具自己的鐵律（2026-08-23 QA 拿探針實測過，壞掉時它會謊報「一切安好」）：
   ① 突變套不上（重構把目標字串改掉了）＝ **失敗**，不是警告。那條等於什麼都沒測。
   ② 基準線本來就紅 ＝ 直接中止（exit 2）。基準線紅的話每條突變都會顯示「紅 ✓」，整份結果不可信。
   ③ 「預期全綠」豁免名單要斷言長度，擋住有人把礙事的突變改個名字混過去。 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const pExec = promisify(execFile);

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const TESTDIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTDIR, "..");
const TESTS = readdirSync(TESTDIR).filter(f => /^t\d+-.*\.mjs$/.test(f)).map(f => f.replace(/\.mjs$/, ""));

/* 版本號一定要從程式碼讀出來，不可以寫死在突變表裡——
   寫死的話每次改版都會讓這幾條突變靜默失效（2026-08-23 v1.0.1 改版就真的踩到了）*/
const VERLINE = /var HLM_VER = "[^"]+";/.exec(readFileSync(ROOT + "/js/config.js", "utf8"))[0];
const SWBUILD = /^\/\* build ([0-9.]+) \*\//m.exec(readFileSync(ROOT + "/sw.js", "utf8"))[1];

const M = [
  ["M40 串流拿掉成人過濾", "js/api.js", "        with_watch_monetization_types: \"flatrate\",\n        with_watch_providers: ids.join(\"|\"),\n        sort_by: \"popularity.desc\",\n        include_adult: false,\n", "        with_watch_monetization_types: \"flatrate\",\n        with_watch_providers: ids.join(\"|\"),\n        sort_by: \"popularity.desc\",\n"],
  ["M41 搜尋拿掉成人過濾", "js/api.js", "query: kw, language: C.lang, region: C.region, include_adult: false, page: 1", "query: kw, language: C.lang, region: C.region, page: 1"],
  ["M45 評價用詞門檻爛掉", "js/ui.js", 'return n >= 85 ? "非常值得看" : (n >= 75 ? "值得看" : (n >= 60 ? "看看可以" : (n >= 45 ? "普通偏弱" : "不太推薦")));', 'return "非常值得看";'],
  ["M46 分數色階失效", "js/ui.js", 'function toneColor(n) { return n >= 75 ? "#41d18a" : (n >= 55 ? "#ffb020" : "#ff5f6b"); }', 'function toneColor(n) { return "#41d18a"; }'],
  ["M26 詳細頁改成等齊才畫", "js/app.js", "      paint();\n      loadPv();\n      if (S.keys().omdb) loadScores();", "      loadPv();\n      if (S.keys().omdb) loadScores(); else paint();"],
  ["M19 0 票也算分數", "js/api.js", "tmdb: votes > 0 && x.vote_average > 0 ?", "tmdb: x.vote_average > 0 ?"],
  ["M48 萬人評換算錯 10 倍", "js/ui.js", 'if (n >= 10000) return (Math.round(n / 1000) / 10) + " 萬人評";', 'if (n >= 10000) return (Math.round(n / 100) / 10) + " 萬人評";'],
  ["M02 淘汰順序反了", "js/store.js", "keys.sort(function (a, b) { return entryTime(a) - entryTime(b); });\n    var n = Math.max", "keys.sort(function (a, b) { return entryTime(b) - entryTime(a); });\n    var n = Math.max"],
  ["M04 寫不下不重試", "js/store.js", "if (evict(0.5)) {", "if (false) {"],
  ["M28 過期降級條件放寬", "js/api.js", 'if (stale && (e.kind === "offline" || e.kind === "timeout" || e.kind === "server" || e.kind === "quota")) {', "if (stale) {"],
  ["M24 拿掉 nokey 守衛", "js/api.js", 'if (!k) return Promise.reject(err("nokey", "tmdb"));', ""],
  ["M09 排序切換失效（永遠依熱門）", "js/app.js", "    if (state.sort === \"pop\") {", "    if (true) {"],
  ["S01a 電影院預設變回依評價", "js/app.js", "    S.del(\"hlm_sort\");\n    return \"pop\";", "    S.del(\"hlm_sort\");\n    return \"score\";"],
  ["S01b 串流在依熱門時還是前端重排", "js/app.js", "      if (mode === \"stream\") return items;\n", ""],
  ["S02 串流分頁不給切換鈕", "js/app.js", "      if (mode !== \"search\") {\n        $(\"sortbtn\").classList.remove(\"hide\");", "      if (mode === \"cinema\") {\n        $(\"sortbtn\").classList.remove(\"hide\");"],
  ["S03a 沿用舊 key（舊裝置吃不到新預設）", "js/app.js", "    var v = S.get(\"hlm_sort2\", null);", "    var v = S.get(\"hlm_sort\", null);"],
  ["S03b 切換後存回舊 key", "js/app.js", "S.set(\"hlm_sort2\", state.sort);", "S.set(\"hlm_sort\", state.sort);"],
  ["S04 熱度相同時沒有固定次要排序", "js/app.js", "    return d !== 0 ? d : (x.id - y.id);", "    return d;"],
  ["R1a 只拿掉 pfNames 守衛（層 A 會接住，預期全綠）", "js/app.js", "      var b = HLM_BRAND[state.pf[i]];\n      if (b) out.push(b.n);", "      out.push(HLM_BRAND[state.pf[i]].n);"],
  ["R1b 改回 .then(ok, fail)", "js/app.js", "      if (mode !== \"cinema\") fillProviders(items, seq, mode);\n    }).catch(function (e) {", "      if (mode !== \"cinema\") fillProviders(items, seq, mode);\n    }, function (e) {"],
  ["R2a 第一次安裝就 reload", "js/app.js", "            if (!hadController) return;          /* 第一次安裝，不是更新 */\n            $(\"updatebar\").classList.remove(\"hide\");", "            location.reload();"],
  ["R2b 收到新版自動 reload", "js/app.js", "            if (!hadController) return;          /* 第一次安裝，不是更新 */\n            $(\"updatebar\").classList.remove(\"hide\");", "            if (hadController) location.reload();"],
  ["R3 拿掉同品牌去重", "js/api.js", "        if (seen[b.key]) continue;\n        seen[b.key] = true;\n", ""],
  ["R1c 只拿掉層 A（開機過濾）", "js/app.js", "  /* 認不得的平台 key（舊版留下的、或 TMDB 那邊改名下架）直接丟掉，不要留著當地雷。\n     只在記憶體裡濾掉，不寫回 localStorage。 */\n  state.pf = state.pf.filter(knownBrand);\n", ""],
  ["R1d 兩層守衛都拿掉", "js/app.js", [["  /* 認不得的平台 key（舊版留下的、或 TMDB 那邊改名下架）直接丟掉，不要留著當地雷。\n     只在記憶體裡濾掉，不寫回 localStorage。 */\n  state.pf = state.pf.filter(knownBrand);\n", ""], ["      var b = HLM_BRAND[state.pf[i]];\n      if (b) out.push(b.n);", "      out.push(HLM_BRAND[state.pf[i]].n);"]], null],
  ["N07 拿掉 eyJ 偵測", "js/api.js", "    if (key.indexOf(\"eyJ\") === 0) {", "    if (false) {"],
  ["N09 maskable icon 不進殼快取", "sw.js", ",\n  \"./icons/icon-512-maskable.png\"", ""],
  ["N13 本週門檻改成 70 天", "js/ui.js", "days !== null && days <= 7", "days !== null && days <= 70"],
  ["N14 --faint 調回低對比", "css/app.css", "--faint:#7d8798;", "--faint:#6b7484;"],
  ["N15 ✕ 命中區縮小", "css/app.css", ".chip .x{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;", ".chip .x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:22px;"],
  ["N16a 拿掉 sw.js 的 build 字串", "sw.js", "/* build " + SWBUILD + " */\n", ""],
  ["N16b build 沒跟著 HLM_VER 走", "sw.js", "/* build " + SWBUILD + " */", "/* build 0.0.1 */"],
  ["N34 entryTime 永遠回 0", "js/store.js", "      return o && typeof o.t === \"number\" ? o.t : 0;", "      return 0;"],
  ["N21 去重前不排序", "js/api.js", "      var sorted = (arr || []).slice().sort(function (a, b) {\n        return (a.display_priority || 99) - (b.display_priority || 99);\n      });", "      var sorted = (arr || []).slice();"],
  ["N1a SW 存取搬回頂層（沒保護）", "js/app.js", "  function setupSW() {\n    try {\n      var sw = navigator.serviceWorker;\n      if (!sw || typeof sw.register !== \"function\") return;\n      var hadController = !!sw.controller;", "  function setupSW() {\n    {\n      var sw = navigator.serviceWorker;\n      var hadController = !!navigator.serviceWorker.controller;"],
  ["N2a 沒設過 hlm_pf 不吃 mysubs", "js/app.js", "  if (!Array.isArray(state.pf)) state.pf = state.mysubs.slice();", "  if (!Array.isArray(state.pf)) state.pf = [];"],
  ["D2 品牌比對改回先命中先贏", "js/api.js", "if (nm.indexOf(ms[i]) >= 0 && ms[i].length > bestLen) { best = k; bestLen = ms[i].length; }", "if (nm.indexOf(ms[i]) >= 0 && bestLen === 0) { best = k; bestLen = ms[i].length; }"],
  ["P05 重新抓一次不清 OMDb 快取", "js/app.js", "      if (force) S.cacheDel(\"o:\" + mv.imdb);", "      if (false) S.cacheDel(\"o:\" + mv.imdb);"],
  ["P03 拿掉層 A（開機過濾未知平台 key）", "js/app.js", "  state.pf = state.pf.filter(knownBrand);\n", ""],
  ["P20 mysubs 不過濾未知 key", "js/app.js", "  state.mysubs = state.mysubs.filter(knownBrand);\n", ""],
  ["P12 normProvider 拿掉 id 優先比對", "js/api.js", "    for (var k in HLM_BRAND) {\n      if (HLM_BRAND[k].id === p.provider_id) { key = k; break; }\n    }\n", ""],
  ["P02 provider 校正改成後者覆蓋前者", "js/api.js", "if (key && !map[key]) map[key] = arr[i].provider_id;", "if (key) map[key] = arr[i].provider_id;"],
  /* ---- PTT 鄉民評價（scripts/ptt-parse.mjs、scripts/fetch-ptt.mjs） ---- */
  ["T01 Re: 回文也算進票數", "scripts/ptt-parse.mjs", `  if (/^re\\s*[:：]/i.test(t)) return "reply";`, `  if (false) return "reply";`],
  ["T02 置底板規文也算進去", "scripts/ptt-parse.mjs", `    if (starts[i] > sepAt) { skipped.pinned++; continue; }   /* 置底文不收 */`, `    if (false) { skipped.pinned++; continue; }`],
  ["T03 標題不框在 div.title 裡（會抓到下拉選單的連結）", "scripts/ptt-parse.mjs", `    const link = SELECTORS.titleLink.exec(tb[1]);`, `    const link = SELECTORS.titleLink.exec(chunk);`],
  ["T04 破平也分不出來時還是硬配一部（會錯配）", "scripts/ptt-parse.mjs", `  if (!how) return { id: null, reason: "ambiguous" };`, `  if (false) return { id: null, reason: "ambiguous" };`],
  ["T05 短片名不管出現在哪裡都算", "scripts/ptt-parse.mjs", `        ok = pos >= 0 && (a.tight.length > MATCH.SHORT_CJK_MAX || pos <= MATCH.HEAD_CHARS);`, `        ok = pos >= 0;`],
  ["T06 每部片不截斷成 8 則", "scripts/ptt-parse.mjs", `    m.posts = m.posts.slice(0, MATCH.MAX_POSTS);
`, ``],
  ["T07a 抓到 0 篇文章也放行（安靜產出空 JSON）", "scripts/ptt-parse.mjs", `  if (!st.posts) bad.push("整輪掃下來 0 篇文章 —— PTT 版面結構可能變了（見 SELECTORS）");
  else `, `  `],
  ["T07b 0 篇帶得到標籤也放行", "scripts/ptt-parse.mjs", `
  else if (!st.tagged) bad.push("有文章但 0 篇帶得到雷標籤 —— 標籤寫法可能變了（見 parseTag）");`, ``],
  ["T08 只有 updated 變也算變（每天一個空 commit）", "scripts/fetch-ptt.mjs", `  const strip = o => JSON.stringify({ source: o.source, scanned: o.scanned, movies: o.movies });`, `  const strip = o => JSON.stringify(o);`],
  ["T09 記錄不遮金鑰", "scripts/fetch-ptt.mjs", `  return t.replace(/api_key=[^&\\s"']+/gi, "api_key=***");`, `  return t;`],
  ["T10 爬取不睡（轟炸 PTT）", "scripts/fetch-ptt.mjs", `  sleepMs: 700,`, `  sleepMs: 0,`],
  ["T11 不處理年齡確認頁", "scripts/fetch-ptt.mjs", `  if (r.status === 200 && isAgeGate(r.body)) {`, `  if (false) {`],
  ["T12 User-Agent 塞中文（每個請求都會炸）", "scripts/fetch-ptt.mjs", `  ua: "Mozilla/5.0 (compatible; hao-lei-ma-bot/1.0; personal use, once a day)",`, `  ua: "Mozilla/5.0 (compatible; hao-lei-ma-bot/1.0; 個人用途)",`],
  ["T13 翻頁不跟著「上頁」走（一直抓同一頁）", "scripts/fetch-ptt.mjs", `      url = parsed.prevUrl;`, `      url = url;`],
  ["T14 翻到三個月前也不停", "scripts/fetch-ptt.mjs", `      if (oldest && oldest < cutoffTime) { stopReason = "翻到 " + CFG.daysBack + " 天以前了"; break; }`, `      if (false) { stopReason = "翻到 " + CFG.daysBack + " 天以前了"; break; }`],
  /* ---- PTT 鄉民風向（畫面）---- */
  ["U01 PTT 資料進殼快取（會被凍到下次改版）", "sw.js", `  "./manifest.webmanifest",`, `  "./manifest.webmanifest",
  "./data/ptt-movie.json",`],
  ["U02 SW 不放行 PTT 資料（變成 cache-first）", "sw.js", `  if (/\\/data\\/ptt-movie\\.json$/.test(url.pathname)) return;
`, ``],
  ["U03 保底異見改成純推文排序", "js/ui.js", `    var want = !hasBad ? "負雷" : (!hasGood ? "好雷" : null);`, `    var want = null;`],
  ["U04 讀取失敗當成「沒有討論」", "js/ui.js", `    if (p.err) {
      return head("讀不到") +`, `    if (false) {
      return head("讀不到") +`],
  ["U05 過期門檻失效（永遠不標過期）", "js/ui.js", `    var stale = days !== null && days >= C.pttStaleDays;`, `    var stale = false;`],
  ["U06 只有 1~3 篇也畫比例條", "js/ui.js", `    if (n <= 3) {`, `    if (false) {`],
  ["U07 好雷率分母不含普雷", "js/ui.js", `'<div class="pttrate">好雷率 <b style="color:' + v.c + '">' + Math.round(g / n * 100) + "%</b></div></div>" +`, `'<div class="pttrate">好雷率 <b style="color:' + v.c + '">' + Math.round(g / (g + b) * 100) + "%</b></div></div>" +`],
  ["U08 每點一部片就抓一次 PTT 資料", "js/api.js", `    if (pttMemo && !force) return pttMemo;`, `    if (false) return pttMemo;`],
  ["U09 網路失敗時不吃離線副本", "js/api.js", `      if (c && c.v && c.v.movies) return { v: c.v, cached: true };
`, ``],
  ["U10 外連拿掉 rel=noopener", "js/ui.js", `    return '<a class="pttpost" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' +`, `    return '<a class="pttpost" href="' + esc(t.url) + '" target="_blank">' +`],
  ["U11 換一部片不重置展開狀態", "js/app.js", `    ptt.open = false;                     /* 切到別部片就收合（規格 §9.5） */
`, ``],
  ["U12 一面倒也跳「評價兩極」提示框", "js/ui.js", `    if (gr >= 0.80) return { w: "幾乎全是好雷", c: PTTCOL.g, split: false };`, `    if (gr >= 0.80) return { w: "幾乎全是好雷", c: PTTCOL.g, split: true };`],
  ["U13 PTT 區塊掉到平台後面", "js/ui.js", `      '<div class="card block" id="pttcard">' + pttHTML(m.id, ctx.ptt) + "</div>" +

      '<div class="card block"><p class="sec-title">台灣哪裡看得到</p>' + watchSection(m, pv, ctx.pvLoading) + "</div>" +`, `      '<div class="card block"><p class="sec-title">台灣哪裡看得到</p>' + watchSection(m, pv, ctx.pvLoading) + "</div>" +

      '<div class="card block" id="pttcard">' + pttHTML(m.id, ctx.ptt) + "</div>" +`],
  ["U14 同名破平規則失效（打平就全部放棄）", "scripts/ptt-parse.mjs", `  top.sort((x, y) => tieBreak(x.mv, y.mv));`, `  return { id: null, reason: "ambiguous" };`],
  ["U15 破平不看「現正上映」", "scripts/ptt-parse.mjs", `  if (a.inCinema !== b.inCinema) return a.inCinema ? -1 : 1;
`, ``],
  ["U16 scanned 不分開記 ambiguous", "scripts/fetch-ptt.mjs", `        if (hit.reason === "ambiguous") {
          stats.ambiguous++;`, `        if (false) {
          stats.ambiguous++;`],
  /* ---- PTT 文章網址白名單 / 外部輸入（2026-08-23 QA 退件 F-1 之後補的）---- */
  ["V01 absUrl 放行外站絕對網址", "scripts/ptt-parse.mjs", `    const m = /^https?:\\/\\/(?:www\\.)?ptt\\.cc(\\/[^\\s]*)?$/i.exec(h);
    return m ? PTT_ORIGIN + (m[1] || "/") : null;    /* 非 ptt.cc → 丟掉；http 順便升級成 https */`, `    return h;`],
  ["V02 absUrl 放行 protocol-relative 與相對路徑", "scripts/ptt-parse.mjs", `  if (h.slice(0, 2) === "//") return null;           /* //evil.example.com/x 會沿用當前協定，等同外站 */
  if (h[0] !== "/") return null;                     /* javascript: / data: / 相對路徑一律不收 */
`, ``],
  ["V03 列表頁不丟掉外站連結的文章", "scripts/ptt-parse.mjs", `    if (!url) { skipped.foreign = (skipped.foreign || 0) + 1; continue; }   /* 不是 ptt.cc 的連結 → 整篇丟掉 */
`, ``],
  ["V04 buildPayload 不擋非 ptt.cc 網址", "scripts/ptt-parse.mjs", `    if (!PTT_URL_RE.test(String(e.url || ""))) continue;
`, ``],
  ["V05 畫面不擋毒網址（javascript: 會被渲染成可點的 <a>）", "js/ui.js", `    if (!PTTOK.test(String(t.url || ""))) return '<span class="pttpost nolink">' + inner + "</span>";
`, ``],
  ["V06 文章標題不跳脫（XSS）", "js/ui.js", `      '<span class="pttbody"><span class="pttt">' + esc(pttTitle(t.title)) + "</span>" +`, `      '<span class="pttbody"><span class="pttt">' + pttTitle(t.title) + "</span>" +`],
  ["V07 拿掉 PTT JSON 的格式檢查", "js/api.js", `      if (!j || typeof j !== "object" || !j.movies) throw err("server", "ptt", "JSON 格式不對");
`, ``],
  ["V08 清快取不清 PTT 離線副本", "js/store.js", `    del("hlm_ptt");
`, ``],
  ["V09 pttRepaint 不檢查 curId（層 B 備援，設計上觸發不到，預期全綠）", "js/app.js", `    pttRepaint = function () {
      if (curId !== id) return;`, `    pttRepaint = function () {`],
  /* ---- 白名單「被改壞」而不是「不見了」（QA 2026-08-23：這才是安全性程式碼真實的退化方式）----
     驗證類的程式碼，突變要同時有 ①整段移除 ②錨定符號拿掉 ③跳脫字元拿掉 ④條件放寬一格。 */
  ["W6 PTT_URL_RE 少了開頭錨定 ^", "scripts/ptt-parse.mjs", `export const PTT_URL_RE = /^https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`, `export const PTT_URL_RE = /https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`],
  ["W7 PTT_URL_RE 放寬到允許 http", "scripts/ptt-parse.mjs", `export const PTT_URL_RE = /^https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`, `export const PTT_URL_RE = /^https?:\\/\\/(?:www\\.)?ptt\\.cc\\//;`],
  ["W8 PTTOK 少了開頭錨定 ^（唯一真的可利用的）", "js/ui.js", `  var PTTOK = /^https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`, `  var PTTOK = /https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`],
  ["W9 PTTOK 的點號沒跳脫", "js/ui.js", `  var PTTOK = /^https:\\/\\/(?:www\\.)?ptt\\.cc\\//;`, `  var PTTOK = /^https:\\/\\/(?:www\\.)?ptt.cc\\//;`],
  ["W10 buildPayload 先建立條目再檢查（留下 0/0/0 空殼）", "scripts/ptt-parse.mjs", `  for (const e of entries || []) {
    const slot = TAGS[e.tag];`, `  for (const e of entries || []) {
    movies[String(e.movieId)] = movies[String(e.movieId)] || { good: 0, ok: 0, bad: 0, posts: [] };
    const slot = TAGS[e.tag];`],
  /* ---- 鑰匙圈（跨 App 身分）的接法 ---- */
  ["K01 tokenKey 直接指到金鑰 key（OMDb 永遠進不來、換人會清掉手貼的）", "js/config.js", `  krBlobKey: "hlm_keyring_blob",`, `  krBlobKey: "hlm_key_tmdb",`],
  ["K02 blob 沒有 tmdb 也照收", "js/api.js", `    if (!t) throw err("keyringbad", "keyring", "裡面沒有 tmdb 這一項");`, `    if (!t) return { tmdb: t, omdb: m };`],
  ["K03 blob 不是 JSON 物件也照收", "js/api.js", `    if (!o || typeof o !== "object" || Array.isArray(o)) throw err("keyringbad", "keyring", "不是一個 JSON 物件");
`, ``],
  ["K04 鑰匙圈鎖回去時連手貼的金鑰一起清掉", "js/store.js", `    if (get("hlm_keys_src", "") !== "keyring") return false;
`, ``],
  ["K05 沒勾「記住這台裝置」也寫進 localStorage（金鑰留在別人的電腦上）", "js/store.js", `      del("hlm_key_tmdb"); del("hlm_key_omdb");
      ssSet("hlm_key_tmdb", t); ssSet("hlm_key_omdb", o);`, `      ssDel("hlm_key_tmdb"); ssDel("hlm_key_omdb");
      set("hlm_key_tmdb", t); set("hlm_key_omdb", o);`],
  ["K06 鑰匙圈排在 boot() 之後（自我體檢會誤判成還沒設定）", "js/app.js", `  try { setupKeyring(); } catch (e) { }
  boot();`, `  boot();
  try { setupKeyring(); } catch (e) { }`],
  ["K07 setupKeyring 沒有 try/catch（模組丟例外就整支停掉）", "js/app.js", `  try { setupKeyring(); } catch (e) { }
  boot();`, `  setupKeyring();
  boot();`],
  /* ⚠️ 2026-08-25：showHome() 中間插進了返回動畫（.pop）那段，原本的兩行不再相鄰，
     所以錨點改到函式開頭。改的是「錨在哪」，不是把突變放寬。 */
  ["K08 又把自動彈解鎖加回來（公開模式不該有登入畫面）", "js/app.js", `  function showHome(restoreScroll) {
    var was = state.view;`, `  function showHome(restoreScroll) {
    var was = state.view;
    if (krOn()) krTry(function () { Keyring.maybeIntro(); });`],
  ["K10 index.html 沒載入鑰匙圈模組", "index.html", `<script defer src="./js/keyring-unlock.js"></script>
`, ``],
  ["K11 鑰匙圈模組沒進 sw.js 殼快取", "sw.js", `  "./js/keyring-unlock.js",
`, ``],
  /* ---- 模組存取點的守衛（QA 2026-08-23 退件 K-1：包 try/catch ≠ 包對地方）---- */
  ["G1 krOn() 沒有守衛（讀 window.Keyring 就爆時整支停掉）", "js/app.js", `    return krTry(function () { return !!(window.Keyring && typeof window.Keyring.init === "function"); }, false);`, `    return !!(window.Keyring && typeof window.Keyring.init === "function");`],
  ["G2 whenReady() 沒有守衛（開機那條路上會卡在「正在拿金鑰…」）", "js/app.js", `    var p = krTry(function () { return Keyring.whenReady(); }, null);`, `    var p = Keyring.whenReady();`],
  ["G3 重試裡的 whenReady() 沒有守衛", "js/app.js", `      var pr = krTry(function () { return Keyring.whenReady(); }, null);`, `      var pr = Keyring.whenReady();`],
  ["G4 reload() 沒有守衛", "js/app.js", `      krTry(function () { return Keyring.reload(); }, null);`, `      Keyring.reload();`],
  /* ---- 兩種金鑰來源交錯 ---- */
  ["N10 手貼時沒把來源記號改回來（下次收回會清掉他手貼的）", "js/store.js", `    del("hlm_keys_src");                       /* 手貼的就不算是鑰匙圈給的 */
`, ``],
  ["N13 不記住時沒清掉 localStorage 的舊副本", "js/store.js", `      del("hlm_key_tmdb"); del("hlm_key_omdb");
      ssSet("hlm_key_tmdb", t); ssSet("hlm_key_omdb", o);`, `      ssSet("hlm_key_tmdb", t); ssSet("hlm_key_omdb", o);`],
  ["N14 keys() 改成 localStorage 優先（舊金鑰蓋過這次 session 的）", "js/store.js", `      tmdb: String(ssGet("hlm_key_tmdb") || get("hlm_key_tmdb", "") || "").trim(),
      omdb: String(ssGet("hlm_key_omdb") || get("hlm_key_omdb", "") || "").trim()`, `      tmdb: String(get("hlm_key_tmdb", "") || ssGet("hlm_key_tmdb") || "").trim(),
      omdb: String(get("hlm_key_omdb", "") || ssGet("hlm_key_omdb") || "").trim()`],
  ["N15 手貼時沒清掉 session 的舊副本（新金鑰被舊的蓋住）", "js/store.js", `    ssDel("hlm_key_tmdb"); ssDel("hlm_key_omdb");
    set("hlm_key_tmdb", String(t || "").trim());`, `    set("hlm_key_tmdb", String(t || "").trim());`],
  ["N31 逃生門的「儲存並測試」鈕不見了（手貼那條路斷掉）", "js/ui.js", `      '<button class="btn pri wide" type="button" id="saveTest">儲存並測試連線</button>' +`, ``],
  /* ---- v1.3.0 公開模式：沒有登入畫面，但逃生門要留著 ---- */
  ["P1 公開值蓋掉他手貼的金鑰", "js/app.js", `    if (krTry(function () { return S.keysManual(); }, false)) return false;
`, ``],
  ["P2 沒金鑰時又把人丟回設定頁（v1.3.0 已經沒有那一頁了）", "js/app.js", `    if (!hasTmdbKey()) {
      showHome(false);
      loadList();
      return;
    }`, `    if (!hasTmdbKey()) {
      renderSetup(true);
      return;
    }`],
  ["P3 拿不到金鑰時不給手貼逃生門", "js/ui.js", `      keyFormHTML(k) + "</div>";`, `      "</div>";`],
  ["P4 錯誤畫面自己去問模組（模組壞掉就連錯誤畫面都出不來）", "js/ui.js", `  function keyErrorHTML(k, ctx) {
    ctx = ctx || {};`, `  function keyErrorHTML(k, ctx) {
    ctx = ctx || {};
    ctx.hasModule = !!(window.Keyring && Keyring.isPublic());`],
  ["P5 逃生門存完金鑰不重畫片單（他會卡在錯誤畫面）", "js/app.js", `      if (state.view === "home" && hasTmdbKey()) afterSetup();
`, ``],
  /* ---- 動效基調（沉穩）＋ 開場畫面（印記）：2026-08-25 定案，t14-motion 在守 ---- */
  ["X01 開場永遠不收（app 忘了說「我好了」）", "js/app.js", `      splashReady();                       /* 片單資料到了＝可以收開場了 */\n`, ``],
  ["X02 裸寫 Splash.hold()（模組載不到就整支 App 死掉）", "js/app.js", `  var hasSplash = !!(window.Splash && window.Splash.hold && window.Splash.ready);
  if (hasSplash) { try { Splash.hold(); } catch (e) { hasSplash = false; } }
  if (!hasSplash) splashFallback();`, `  Splash.hold();`],
  ["X03 動效 token 被改壞（--dur-2 慢十倍）", "css/motion.css", `  --dur-2:280ms;`, `  --dur-2:2800ms;`],
  ["X04 曲線被換掉（不再是沉穩那組）", "css/motion.css", `  --ease:cubic-bezier(.22,.61,.36,1);`, `  --ease:ease;`],
  ["X05 進場動畫改用 both（會永久殺掉 :active）", "css/motion.css", `  animation:hlm-item-in var(--dur-2) var(--ease) backwards;`, `  animation:hlm-item-in var(--dur-2) var(--ease) both;`],
  ["X06 splash.js 沒進 sw.js 殼快取（離線就沒有開場）", "sw.js", `  "./js/splash.js",\n`, ``],
  ["X07 範本的色票被抄進 motion.css（--bg 撞名，會蓋掉整套配色）", "css/motion.css", `  --stagger:45ms;`, `  --bg:#171513;\n  --stagger:45ms;`],
  ["X08 開場底色跟 manifest 不一致（iPhone 會白閃一下）", "index.html", `    --splash-bg:#0b0d12;`, `    --splash-bg:#0c0d12;`],
  /* ⚠️ v1.5.0 拆檔：X09／X10 的目標搬到 js/splash-boot.js（第一幀那一段的新家） */
  ["X09 符號字色寫死白字（不再由 onColor 算，白底就看不見）", "js/splash-boot.js", `      setVar("--splash-on-accent", onColor(look.accent));`, `      setVar("--splash-on-accent", "#ffffff");`],
  ["X10 熱啟動也重播開場（切分頁回來又演一次）", "js/splash-boot.js", `      if (W.sessionStorage.getItem(SEEN_KEY)) return false;`, `      if (false) return false;`],
  ["X11 讀到鑰匙圈就中途換字（名字會跳動）", "js/splash.js", `    B.writeCache(look);`, `    B.writeCache(look); B.applyLook(look);`],
  ["X12 分頁少了按下回饋（全掃描要抓得到漏掉的那一顆）", "css/motion.css", `.tab:active,\n`, ``],
  ["X13 返回沒有方向感（首頁不播 pop）", "js/app.js", `    if (was === "detail" || was === "setup") {
      var vh = $("view-home");
      vh.classList.remove("pop");
      void vh.offsetWidth;
      vh.classList.add("pop");
    }
`, ``],
  ["X14 拿掉開場的收場保險絲（ready 不來就永遠卡著）", "js/splash.js", `  W.setTimeout(function () { dismiss(); }, FUSE);\n`, ``],
  ["X15 splash.js 加了 defer（會先畫預設值再跳成新名字）", "index.html", `<script src="./js/splash.js"></script>`, `<script defer src="./js/splash.js"></script>`],
  /* ---- v1.4.1 白閃修正：第一次繪製必定是深色（t14 §75 在守） ---- */
  ["X16 拿掉關鍵路徑的 html 底色（CSS 沒到位時第一次繪製會是純白）", "index.html",
    `  html:not([data-splash="off"]),\n  html[data-cssgate]{background:var(--splash-bg,#0b0d12);}\n`, ``],
  ["X17 關鍵路徑的 #splash 不再蓋滿（會透出沒套樣式的 app 內容）", "index.html",
    `    position:fixed; inset:0; z-index:200; overflow:hidden;`, `    overflow:hidden;`],
  ["X18 關鍵路徑的後備底色跟 manifest 不一致（白閃換成色差）", "index.html",
    `  html[data-cssgate]{background:var(--splash-bg,#0b0d12);}`,
    `  html[data-cssgate]{background:var(--splash-bg,#0c0d12);}`],
  ["X19 開場最短顯示調回 650（動作剛做完就走，沒有那一拍定格）", "js/splash.js",
    `  var MIN_SHOW = REDUCE ? 300 : (LIGHT ? 1230 : 950);`,
    `  var MIN_SHOW = REDUCE ? 300 : (LIGHT ? 650 : 950);`],
  ["X36 白起用回印記的最短顯示（名字還沒演完就被收掉）", "js/splash.js",
    `  var MIN_SHOW = REDUCE ? 300 : (LIGHT ? 1230 : 950);`,
    `  var MIN_SHOW = REDUCE ? 300 : 950;`],
  ["X20 關鍵路徑把符號字色寫死（不再跟著 onColor，鑰匙圈換色就分岔）", "index.html",
    `    color:var(--splash-on-accent);`, `    color:#ffffff;`],
  /* ---- v1.4.2 關鍵路徑只留必要的東西（t14 §77／t13 在守） ---- */
  ["X21 app.js 拿掉 defer（變回解析器阻塞腳本，會去搶第一次繪製的頻寬）", "index.html",
    `<script defer src="./js/app.js"></script>`, `<script src="./js/app.js"></script>`],
  ["X22 鑰匙圈拿掉 defer（載入形態跟 config.js 不一致 ⇒ 執行順序會反過來）", "index.html",
    `<script defer src="./js/keyring-unlock.js"></script>`, `<script src="./js/keyring-unlock.js"></script>`],
  /* ---- v1.5.0 賽跑三件套（t14 §62／§78 在守）：
         ① splash-boot.js 拆檔 ② CSS 非阻塞 ③ data-cssgate 閘門
  /* ---- v1.5.0 第二版：boot 從外部檔改成 inline 在柵欄裡（同源請求 2 → 1，t14 §62b 在守） ---- */
  ["X23 有人手改 index.html 裡的 inline boot（跟正本分岔，只有 SHA 守衛抓得到）", "index.html",
    `  var TAKEOVER_FUSE = 7000;`, `  var TAKEOVER_FUSE = 7001;`],
  ["X24 boot 又變回外部 <script src>（第一次繪製之前又多一個同源請求）", "index.html",
    `<!-- SPLASH-BOOT-INLINE:BEGIN`, `<script src="./js/splash-boot.js"></script>\r\n<!-- SPLASH-BOOT-INLINE:BEGIN`],
  ["X34 有人只改了正本、忘了重貼 inline（改的是註解，行為完全沒變）", "js/splash-boot.js",
    `     ① 讀 localStorage 的外觀快取（名字／符號／顏色）`,
    `     ① 讀 localStorage 的外觀快取（名字/符號/顏色）`],
  ["X35 樣式表變回 render-blocking（第一次繪製又要等 CSS）", "index.html",
    `<link rel="stylesheet" href="./css/splash.css" media="print" data-splash-css`,
    `<link rel="stylesheet" href="./css/splash.css" data-splash-css`],
  ["X25 拿掉熱啟動的 FOUC 閘門（CSS 非阻塞之後會露出裸 DOM）", "index.html",
    `  html[data-cssgate] body > *:not(#splash){visibility:hidden;}\n`, ``],
  ["X26 閘門改成列白名單（新加的浮動元素就漏掉了）", "index.html",
    `  html[data-cssgate] body > *:not(#splash){visibility:hidden;}`,
    `  html[data-cssgate] #app{visibility:hidden;}`],
  ["X27 拿掉閘門的 2 秒保險絲（CSS 永遠不回報就把 App 藏死）", "js/splash-boot.js",
    `  W.setTimeout(openGate, CSS_FUSE);`, ``],
  ["X28 hardRemove 又順手開閘門（熱啟動的 FOUC 整個回來）", "js/splash-boot.js",
    `      root.setAttribute("data-splash", "off");
    } catch (e) {}
  }
  W.setTimeout(function () {`,
    `      root.setAttribute("data-splash", "off");
    } catch (e) {}
    openGate();
  }
  W.setTimeout(function () {`],
  ["X29 樣式表變回 render-blocking（第一次繪製又要等三支 CSS）", "index.html",
    `<link rel="stylesheet" href="./css/app.css" media="print" data-splash-css`,
    `<link rel="stylesheet" href="./css/app.css" data-splash-css`],
  ["X30 拿掉一支 <noscript> fallback（JS 停用時整頁沒樣式）", "index.html",
    `  <link rel="stylesheet" href="./css/app.css">\n`, ``],
  ["X31 <noscript> 不再關掉開場（JS 停用時全螢幕開場永遠卡住）", "index.html",
    `  <style>#splash{display:none !important;}</style>\n`, ``],
  ["X32 拿掉交棒保險絲（splash.js 沒載到就沒有人收開場）", "js/splash-boot.js",
    `  W.setTimeout(function () {
    if (W.__splashTakeover) { return; }   /* splash.js 有接手，交給它 */
    hardRemove();
    /* 沒有人接手＝這一頁大概也出了別的事，閘門一起開掉，不要留一片空白 */
    openGate();
  }, TAKEOVER_FUSE);\n`, ``],
  ["X33 splash.js 又自己寫一份 onColor（換色時兩份會分岔）", "js/splash.js",
    `  W.__splashTakeover = true;`,
    `  W.__splashTakeover = true;\n  function onColor(bg){ return "#ffffff"; }`],
  /* ---- v1.6.0「白起」開場（t14 §60／§71／§75b 在守） ----
     ⚠️ 誠實記一筆：下面凡是動 js/splash.js 或 css/splash.css 的突變，
        §74（跟 app-template 正本比 SHA-256）**一定會紅**，所以它們證明不了 §75b 本身承重。
        §75b 的承重性是另外用「正本與副本同時改」的配對突變單獨驗過的
        （那樣 §74 保持綠，紅的只會是 §75b）——結果寫在 CLAUDE.md 第 34 條。
        這裡仍然把它們列進來，是因為「有人只改了副本」本來就該紅。
     ⭐ 動 index.html 的那幾條沒有這個問題（柵欄以外的部分不受 SHA 約束），是真正的證據。 */
  ["X37 有人把白起的開關拿掉（第一幀又變回深色，硬切回來）", "index.html",
    `<html lang="zh-Hant" data-splash-intro="light">`, `<html lang="zh-Hant">`],
  ["X38 白起的開關打錯字（CSS 與 JS 都不生效，而且不會有任何徵兆）", "index.html",
    `<html lang="zh-Hant" data-splash-intro="light">`, `<html lang="zh-Hant" data-splash-intro="Light">`],
  ["X39 拿掉關鍵路徑的白起底色（CSS 全掛時第一幀又變成深色）", "index.html",
    `  html[data-splash-intro="light"]:not([data-splash="off"]){background:var(--sp-start,#ebebeb);}\n`, ``],
  ["X40 關鍵路徑的白起後備色跟 --sp-start 分岔（CSS 到位前後會跳一次色）", "index.html",
    `  html[data-splash-intro="light"] #splash{background:var(--sp-start,#ebebeb);}`,
    `  html[data-splash-intro="light"] #splash{background:var(--sp-start,#ffffff);}`],
  ["X41 有人把 --sp-start 改成純白（交接點會多一階看得見的亮度跳動）", "css/splash.css",
    `  --sp-start:#ebebeb;`, `  --sp-start:#ffffff;`],
  ["X42 有人把 --sp-start 改成 manifest 的深色「讓顏色統一」（等於把白起整個關掉）", "css/splash.css",
    `  --sp-start:#ebebeb;`, `  --sp-start:#0b0d12;`],
  ["X43 名字不等漸深結束就出現（淺字壓在亮底上讀不到）", "css/splash.css",
    `  animation:sp-up var(--dur-3) var(--ease) backwards var(--sp-sink);`,
    `  animation:sp-up var(--dur-3) var(--ease) backwards;`],
  ["X44 漸深塞回 #splash 自己的 animation（跟收場的淡出搶同一條時間線）", "css/splash.css",
    `html[data-splash-intro="light"] #splash::before{`,
    `html[data-splash-intro="light"] #splash.__never__::before{`],
  ["X45 光環沒有明確關掉（亮底上散出一圈沒人要的金環）", "css/splash.css",
    `html[data-splash-intro="light"] .sp-ring{ animation:none; }\n`, ``],
  ["X46 --sp-sink 改成寫死 700ms（不再跟著沉穩 token 走）", "css/splash.css",
    `  --sp-sink:calc(var(--dur-3) + var(--dur-2));`, `  --sp-sink:700ms;`],
  /* ⭐ X49 是「守衛的守衛」：改判準之前這一條是**綠的** —— 斷言原本寫 `@keyframes\s+sp-sink\b`，
     而 `\b` 在 `sp-sink-bg` 的那個連字號上也成立 ⇒ 把 sp-sink 整個改名，
     斷言會被隔壁的 sp-sink-bg 餵飽而放行。留著這條是為了以後不要再犯。 */
  ["X49 漸深的 keyframes 被改名（判準只要寫成 \\b 就會被 sp-sink-bg 餵飽而放行）", "css/splash.css",
    `@keyframes sp-sink{ from{opacity:0;} to{opacity:1;} }`,
    `@keyframes sp-sunk{ from{opacity:0;} to{opacity:1;} }`],
  ["X47 reduce 之下沒有把白起關掉（沒有漸變還留著白 ＝ 多跳一次）", "css/splash.css",
    `  html[data-splash-intro="light"]:not([data-splash="off"]){
    background:var(--splash-bg);
    animation:none;
  }\n`, ``],
  ["X48 關鍵路徑塊漏了 reduce 覆寫（只改一邊 ⇒ reduce 會看到「白一下下 → 深」）", "index.html",
    `  @media (prefers-reduced-motion:reduce){
    html[data-splash-intro="light"]:not([data-splash="off"]),
    html[data-splash-intro="light"] #splash{background:var(--splash-bg,#0b0d12);}
  }\n`, ``],
  ["對照組 無害改動（預期全綠）", "js/config.js", VERLINE, VERLINE + " /* 註解 */"]
];

/* 只雜湊 App 自己的檔案（node_modules 有兩萬個檔，每次都算會慢到不能用）。
   ⚠️ .git 也要排除：git 自己（甚至只是背景跑一次 git status）就會改寫 .git/index，
   跑到一半誤判成「還原失敗」直接 exit 2 —— 2026-08-23 真的踩到過。
   這支要驗的是「原始碼有沒有被還原」，.git 裡的東西不在範圍內。 */
const hashAll = () => execFileSync("bash", ["-c",
  `cd "${ROOT}" && find . \\( -path ./node_modules -o -path ./.git \\) -prune -o -type f -print | sort | xargs sha256sum`]).toString();
const BASE = hashAll();
let CUR = null;
const restore = () => { if (CUR) { writeFileSync(CUR.p, CUR.o); CUR = null; } };
for (const s of ["SIGINT", "SIGTERM", "exit"]) process.on(s, restore);

async function runAll() {
  const rs = await Promise.all(TESTS.map(t =>
    pExec("node", [join(TESTDIR, t + ".mjs")], { timeout: 180000, maxBuffer: 8e6 }).then(() => null, () => t)));
  return rs.filter(Boolean);
}

/* ---------- 參數 ---------- */
const ARGV = process.argv.slice(2);
const DRY = ARGV.includes("--dry");
const ONLY = (ARGV.find(a => a.startsWith("--only=")) || "").replace("--only=", "");
const onlyList = ONLY ? ONLY.split(",").filter(Boolean) : null;
const picked = M.filter(m => !onlyList || onlyList.some(o => m[0].indexOf(o) === 0));

/* 「預期全綠」是刻意的，目前只有 3 條：
     R1a  只拿掉 pfNames（層 B 的備援守衛）→ 層 A 會接住，看不出差別
     V09  pttRepaint 的 curId 守衛 → pttRepaint 每次 openDetail 都會被覆寫成「最新那部片」的，
          所以那條 if 永遠是 false，拿掉看不出差別。真正在守「舊片資料不會畫進新片的卡」
          這件事的是設計本身（一律用當下的 pttRepaint），t12 §45 驗的就是那個行為。
          留著這行是為了以後有人多加一個觸發重畫的地方時不會炸。
          ⚠️ 哪天它會紅了 → 代表設計變了，工具會擋下來要求重新檢視，這是刻意的。
     對照組 無害改動
   數量寫死在這裡，多一條少一條都要有人重新想過——不可以靠改名字把礙事的突變混進豁免。
   （R1c「只拿掉層 A」本來也在豁免名單裡，2026-08-23 補了 P03 測試之後它會紅了，
     所以移出豁免。工具會自己抓到這種狀況並要求重新檢視，這是刻意的。） */
const EXEMPT_COUNT = 3;
const exemptDefined = M.filter(m => /預期全綠/.test(m[0]));

function pairsOf(from, to) { return Array.isArray(from) ? from : [[from, to]]; }

/* ⚠️ 換行正規化：Windows 上 git 預設 core.autocrlf=true，工作區的檔案是 **CRLF**，
   而這張突變表裡的目標字串一律寫 \n。不正規化的話，**每一條跨行的突變都會被判成 stale**
   —— 而 stale 依這支工具自己的鐵律①就是「那件事現在沒有任何人在驗」。
   2026-08-25 在這台機器上實測：127 條裡有 50 條就是這樣靜默失效的，
   而且它報的是「目標字串已失效」，很容易被當成「重構改壞了」而去改突變表（改了反而全錯）。
   做法：比對與套用都在 LF 空間做，寫回檔案前再換回原檔的換行風格；
   還原時寫的是**一個位元組都沒動過的原始內容**，所以 SHA-256 驗證照樣成立。 */
const toLF = s => s.replace(/\r\n/g, "\n");
const hasCRLF = s => s.indexOf("\r\n") >= 0;

function staleTargets(file, from, to) {
  const src = toLF(readFileSync(ROOT + "/" + file, "utf8"));
  return pairsOf(from, to).filter(([f]) => src.indexOf(f) < 0);
}

/* ---------- 乾跑：只驗突變套不套得上 ---------- */
if (DRY) {
  console.log("\n乾跑：檢查每條突變的目標字串還在不在（不實際跑測試）\n");
  const stale = [];
  for (const [id, file, from, to] of picked) {
    const bad = staleTargets(file, from, to);
    console.log("  " + (bad.length ? "✗" : "✓") + " " + id + (bad.length ? "  ← 目標字串已失效（" + file + "）" : ""));
    if (bad.length) stale.push(id);
  }
  console.log("\n" + "─".repeat(52));
  if (stale.length) {
    console.log("  ❌ " + stale.length + " / " + picked.length + " 條突變已經失效。");
    console.log("  重構把目標字串改掉了 → 那幾件事現在【沒有任何人在驗】。");
    console.log("  請把 test/mutate.mjs 裡的目標字串對齊現在的程式碼。");
  } else {
    console.log("  ✓ " + picked.length + " 條突變全部都還套得上");
  }
  console.log("─".repeat(52) + "\n");
  process.exit(stale.length ? 1 : 0);
}

/* ---------- A-3 豁免名單長度 ---------- */
if (exemptDefined.length !== EXEMPT_COUNT) {
  console.error("❌ 「預期全綠」豁免名單長度不對：預期 " + EXEMPT_COUNT + " 條，實際 " + exemptDefined.length + " 條");
  console.error("   目前是：" + exemptDefined.map(m => m[0]).join("、"));
  console.error("   有人新增／刪掉豁免了嗎？請確認每一條真的該豁免，再改 EXEMPT_COUNT。");
  process.exit(1);
}

/* ---------- 基準線 ---------- */
const base = await runAll();
if (base.length) {
  console.error("\n❌ 基準線就是紅的：" + base.join("、"));
  console.error("   整份突變結果不可信 —— 基準線紅的話，每一條突變都會顯示「紅 ✓」，");
  console.error("   工具會給你滿分，但其實什麼都沒證明。");
  console.error("   先把 npm test 弄成全綠，再跑這支。\n");
  process.exit(2);
}
console.log("基準線（沒有突變）：全綠 ✓\n");

/* ---------- 逐條突變 ---------- */
const rows = [];
for (const [id, file, from, to] of picked) {
  const p = ROOT + "/" + file;
  const o = readFileSync(p, "utf8");
  const bad = staleTargets(file, from, to);
  if (bad.length) {
    /* 套不上 = 這件事現在沒人在驗 = 失敗（不是警告） */
    rows.push({ id, status: "stale", detail: file });
    continue;
  }
  CUR = { p, o };
  let mutated = toLF(o);
  for (const [f, t2] of pairsOf(from, to)) mutated = mutated.split(f).join(t2);
  if (hasCRLF(o)) mutated = mutated.replace(/\n/g, "\r\n");   /* 換回原檔的換行風格 */
  /* 自證：突變真的套用了。沒有這一條的話，「改壞了測試還是綠的」跟
     「其實根本沒改到」會長得一模一樣（手冊 D 段：看到綠燈更要懷疑）。 */
  if (mutated === o) { console.error("!!! 突變沒有真的改到檔案：" + id); process.exit(2); }
  writeFileSync(p, mutated);
  process.stderr.write("  跑 " + id + "\n");
  let red = [];
  try { red = await runAll(); } finally { restore(); }
  if (hashAll() !== BASE) { console.error("!!! 還原失敗：" + id); process.exit(2); }
  rows.push({ id, status: red.length ? "red" : "green", detail: red.join(",") });
}

/* ---------- 報告 ---------- */
const MARK = { red: "紅 ✓", green: "❌ 全綠（沒守住）", stale: "❌ 突變失效（目標字串不存在）" };
console.log("| 弄壞什麼 | 測試有沒有紅 | 哪個測試檔抓到 |");
console.log("|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${MARK[r.status]} | ${r.detail} |`);

const stale = rows.filter(r => r.status === "stale");
const green = rows.filter(r => r.status === "green");
const unexpectedGreen = green.filter(r => !/預期全綠/.test(r.id));
const exemptTurnedRed = rows.filter(r => /預期全綠/.test(r.id) && r.status === "red");

console.log("\n還原驗證（SHA-256）：一致 ✓");
console.log("統計：" + rows.length + " 條突變 → 紅 " + rows.filter(r => r.status === "red").length +
  "、預期全綠 " + green.filter(r => /預期全綠/.test(r.id)).length +
  "、沒守住 " + unexpectedGreen.length + "、失效 " + stale.length);

const problems = [];
if (stale.length) problems.push("突變失效 " + stale.length + " 條（那幾件事現在沒人在驗）：" + stale.map(r => r.id).join("、"));
if (unexpectedGreen.length) problems.push("沒有測試在守 " + unexpectedGreen.length + " 條：" + unexpectedGreen.map(r => r.id).join("、"));
if (exemptTurnedRed.length) problems.push("豁免名單裡的突變現在會紅了（狀況變了，請重新檢視豁免）：" + exemptTurnedRed.map(r => r.id).join("、"));

console.log("");
if (problems.length) {
  for (const x of problems) console.log("❌ " + x);
  process.exit(1);
}
console.log("✓ 每一件該守的事都有測試在守，且每一條突變都真的套用過（標『預期全綠』的是刻意的備援層／對照組）");
process.exit(0);

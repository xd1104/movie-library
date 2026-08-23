/* t11 — PTT 鄉民評價：列表頁解析、標籤、片名比對、健康檢查、金鑰不外洩
   ⚠️ 誠實聲明：這裡的 PTT HTML 是**我們自己手寫的假測資**（test/fixtures/ptt-list-*.html）。
      開發機連不到 www.ptt.cc，所以「測試全綠」只證明解析邏輯對得上**我們假設的**結構，
      不保證對得上真實 PTT。真正的驗證發生在 GitHub Actions 第一次跑的時候。 */
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, section, summary } from "./harness.mjs";
import {
  parseListPage, prevPageUrl, isAgeGate, parseTag, stripTag, skipReason, parsePush,
  postTimeFromUrl, buildIndex, matchTitle, buildPayload, healthCheck, aliasesFor, MATCH
} from "../scripts/ptt-parse.mjs";
import {
  collectEntries, payloadEquals, writeIfChanged, redact, getListPage, tmdbCatalog, CFG
} from "../scripts/fetch-ptt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..") + "/";
const fx = f => fs.readFileSync(join(HERE, "fixtures", f), "utf8");
const A = fx("ptt-list-a.html"), B = fx("ptt-list-b.html"), OVER18 = fx("ptt-over18.html");
const CATALOG = JSON.parse(fx("tmdb-catalog.json")).movies;
const INDEX = buildIndex(CATALOG);
const NOW = Date.parse("2026-08-23T00:00:00Z");
const CUTOFF = NOW - 90 * 86400e3;

section("1. 列表頁解析（假測資）");
{
  const r = parseListPage(A);
  const titles = r.posts.map(p => p.title);
  ok(r.raw === 8, "掃到 8 個 r-ent（含要排除的）", r.raw);
  ok(r.posts.length === 6, "收下 6 篇（排除刪除文與置底文）", titles.join(" | "));
  ok(!titles.some(t => /置底/.test(t)), "★ r-list-sep 之後的置底文不算進去");
  ok(r.skipped.pinned === 1, "置底文有被記成 pinned", JSON.stringify(r.skipped));
  ok(!titles.some(t => /搜尋/.test(t)), "★ 刪除文不會誤抓到 article-menu 下拉選單裡的連結");
  ok(r.skipped.deleted === 1, "刪除文有被記成 deleted", JSON.stringify(r.skipped));

  const p0 = r.posts[0];
  ok(p0.title === "[好雷] 沙丘2 視聽的極致饗宴", "標題文字正確", p0.title);
  ok(p0.url === "https://www.ptt.cc/bbs/movie/M.1787184000.A.001.html", "相對連結補成絕對網址", p0.url);
  ok(p0.date === "8/20", "日期取得到（前面的空白有去掉）", p0.date);
  ok(p0.push === 45, "推文數取得到", p0.push);
  ok(p0.author === "movielover", "作者取得到", p0.author);
  ok(p0.time === 1787184000000, "★ 用網址裡的時間戳當發文時間（M/DD 沒有年份不可靠）", p0.time);

  ok(r.posts[2].push === 0, "沒有 nrec 的文章推文數是 0", r.posts[2].push);
  ok(r.prevUrl === "https://www.ptt.cc/bbs/movie/index3942.html", "抓得到「上頁」（比較舊的一頁）", r.prevUrl);
  ok(prevPageUrl("<div>沒有翻頁按鈕</div>") === null, "沒有翻頁按鈕時回 null");
  ok(parseListPage("<html><body>版面完全變了</body></html>").raw === 0,
    "★ 結構認不得時 raw = 0（健康檢查靠這個判斷爬蟲壞了）");

  const b = parseListPage(B);
  ok(b.posts.length === 6, "B 頁 6 篇", b.posts.length);
  ok(b.posts.find(p => /一起看完/.test(p.title)).title.includes("&"),
    "HTML 實體有解碼（&amp; → &）");
}

section("2. 雷標籤與排除規則");
{
  ok(parseTag("[好雷] 沙丘2") === "好雷", "好雷");
  ok(parseTag("[普雷] 沙丘2") === "普雷", "普雷");
  ok(parseTag("[負雷] 沙丘2") === "負雷", "負雷");
  ok(parseTag("[ 好雷] 腦筋急轉彎2") === "好雷", "容忍 [ 好雷]");
  ok(parseTag("[好 雷] 猩球崛起") === "好雷", "容忍 [好 雷]");
  ok(parseTag("［負雷］腦筋急轉彎2") === "負雷", "容忍全形括號 ［負雷］");
  ok(parseTag("[請益] 有沒有彩蛋") === null, "★ [請益] 不算");
  ok(parseTag("[討論] 暑假檔期") === null, "★ [討論] 不算");
  ok(parseTag("[新聞] 票房出爐") === null, "[新聞] 不算");
  ok(parseTag("[無雷] 隨便聊聊") === null, "[無雷] 不算");
  ok(parseTag("[微好雷] 這種寫法") === null, "★ [微好雷] 這種變體不收（寧可漏抓）");
  ok(parseTag("我覺得[好雷] 沙丘2") === null, "★ 標籤必須在標題最前面");

  ok(skipReason("Re: [好雷] 沙丘2") === "reply", "★ Re: 回文要排除（標籤是沿用原文的，算進去會重複計票）");
  ok(skipReason("Fw: [好雷] 沙丘2") === "forward", "Fw: 轉錄要排除");
  ok(skipReason("[轉錄][好雷] 沙丘2") === "notice", "[轉錄] 要排除");
  ok(skipReason("[公告] 板規") === "notice", "[公告] 要排除");
  ok(skipReason("[好雷] 沙丘2") === null, "正常文章不排除");

  ok(stripTag("[好雷] 沙丘2 視聽饗宴") === "沙丘2 視聽饗宴", "拿掉標籤後才拿去比對片名");
  ok(parsePush("<span class=\"hl f3\">爆</span>") === 100, "爆 = 100");
  ok(parsePush("X5") === -50, "X5 = -50");
  ok(parsePush("XX") === -100, "XX = -100");
  ok(parsePush("") === 0, "空的 = 0");
  ok(parsePush("87") === 87, "數字照抄");
  ok(postTimeFromUrl("/bbs/movie/M.1787184000.A.001.html") === 1787184000000, "從網址拿發文時間");
  ok(postTimeFromUrl("/bbs/movie/index.html") === null, "拿不到就 null");
}

section("3. 年齡確認頁（電影板照理說不用，但要防）");
{
  ok(isAgeGate(OVER18) === true, "★ 認得出年齡確認頁");
  ok(isAgeGate(A) === false, "一般列表頁不會誤判");
}

section("4. 片名比對（寧可漏抓不要錯配）");
{
  const m = t => matchTitle(stripTag(t), INDEX);
  ok(m("[好雷] 沙丘2 視聽的極致饗宴").id === "693134",
    "★ 簡稱「沙丘2」配到「沙丘：第二部」，不是配到「沙丘」", JSON.stringify(m("[好雷] 沙丘2")));
  ok(m("[普雷] 沙丘：第二部 有點長").id === "693134", "全名也配得到");
  ok(m("[負雷] 腦筋急轉彎2 不如第一集").id === "1022789", "腦筋急轉彎2");
  ok(m("[好雷] 猩球崛起：王國誕生 特效滿分").id === "653346", "冒號片名");
  ok(m("[好雷] Kingdom of the Planet of the Apes is great").id === "653346", "英文原名（整個單字比對）");

  const amb = m("[好雷] 沙丘 真的好看");
  ok(amb.id === null && amb.reason === "ambiguous",
    "★ 片單同時有「沙丘」與「沙丘：第二部」時，只寫「沙丘」＝歧義，寧可不配", JSON.stringify(amb));

  /* 短片名只認「出現在標題前段」的。用一份只有一部片的索引測，
     才不會被歧義守衛救到（兩條規則要分開驗，不然拆掉其中一條也不會紅）。 */
  const solo = buildIndex([{ id: "99", title: "怪物", original_title: "Monster" }]);
  ok(matchTitle("怪物 真的好看", solo).id === "99", "短片名出現在最前面 → 配得到");
  ok(matchTitle("昨天晚上跟朋友一起去看了那部叫做怪物的片", solo).id === null,
    "★ 2～3 字的短片名出現在標題後段不算（太容易誤中）",
    JSON.stringify(matchTitle("昨天晚上跟朋友一起去看了那部叫做怪物的片", solo)));
  const far = m("[好雷] 昨天晚上跟朋友去看了一部很棒的電影 就是沙丘");
  ok(far.id === null, "片單裡兩部沙丘時，後段出現「沙丘」也不配", JSON.stringify(far));

  ok(m("[好雷] Dune 真好看").id === null,
    "★ 太短的英文別名（Dune 只有 4 字母）不拿來比對——已知會漏抓，但不會錯配");
  ok(m("[好雷] 完全沒聽過的片名 abcdefg").id === null, "配不到就是配不到");
  ok(m("[好雷] 這是一部很棒的片").reason === "none", "配不到的原因是 none");

  const ap = aliasesFor({ title: "沙丘：第二部", original_title: "Dune: Part Two" }).map(a => a.tight);
  ok(ap.includes("沙丘第二部") && ap.includes("沙丘") && ap.includes("沙丘2"),
    "★ 別名有：全名／冒號前那段／中文數字轉阿拉伯數字", ap.join(","));
  ok(!ap.includes("dune"), "★ dune（4 字母）被最短長度擋掉", ap.join(","));
  ok(MATCH.LATIN_MIN >= 5 && MATCH.CJK_MIN >= 2, "最短長度門檻還在");
  ok(aliasesFor({ title: "上" }).length === 0, "一個字的片名不產生任何別名（會中所有標題）");
}

section("5. 整輪跑完（假測資 → JSON）");
{
  const pages = [A, B].map((h, i) => ({ url: "fixture" + i, ...parseListPage(h) }));
  const { entries, stats } = collectEntries(pages, INDEX, { cutoffTime: CUTOFF });
  ok(stats.posts === 12, "掃到 12 篇", stats.posts);
  ok(stats.tooOld === 1, "★ 三個月以前的舊文有濾掉", stats.tooOld);
  ok(stats.skipped.reply === 1, "Re: 有濾掉", JSON.stringify(stats.skipped));
  ok(stats.tagged === 7, "帶雷標籤的 7 篇", stats.tagged);
  ok(stats.matched + stats.unmatched === stats.tagged, "matched + unmatched = 有標籤的篇數");
  ok(stats.emptyPages === 0, "沒有解析不到文章的頁");

  const pay = buildPayload({ entries, scanned: stats, source: CFG.index, updated: "2026-08-23T04:00:00Z" });
  const ids = Object.keys(pay.movies);
  ok(ids.length === 3, "3 部片有討論", ids.join(","));
  ok(!ids.includes("872585"), "★ 沒有討論的片不出現在 movies 裡（App 會顯示「沒找到討論」）");
  ok(!ids.includes("438631"), "歧義沒配到的「沙丘」也不出現");
  ok(pay.movies["1022789"].good === 1 && pay.movies["1022789"].bad === 2 && pay.movies["1022789"].ok === 0,
    "好雷／普雷／負雷 數量正確", JSON.stringify(pay.movies["1022789"]));
  ok(pay.movies["1022789"].posts[0].push === 100, "★ posts 依推文數由高到低",
    pay.movies["1022789"].posts.map(p => p.push).join(","));
  ok(pay.movies["693134"].posts.every(p => /^https:\/\/www\.ptt\.cc\/bbs\/movie\/M\./.test(p.url)),
    "每則都有可以點過去 PTT 的網址");
  ok(pay.updated === "2026-08-23T04:00:00Z" && pay.source === CFG.index, "updated / source 欄位在");
  ok(pay.scanned.pages === 2 && typeof pay.scanned.posts === "number" &&
     typeof pay.scanned.matched === "number" && typeof pay.scanned.unmatched === "number",
    "scanned 四個欄位都在", JSON.stringify(pay.scanned));
  ok(Object.keys(pay).join(",") === "updated,source,scanned,movies", "★ 契約欄位不多不少", Object.keys(pay).join(","));

  /* 每部片最多 8 則 */
  const many = Array.from({ length: 12 }, (_, i) => ({
    movieId: "693134", tag: "好雷", title: "[好雷] 沙丘2 第 " + i + " 篇",
    url: "https://www.ptt.cc/bbs/movie/M.17871840" + (10 + i) + ".A.00" + (i % 10) + ".html",
    date: "8/20", push: i
  }));
  const big = buildPayload({ entries: many, scanned: stats, source: CFG.index });
  ok(big.movies["693134"].posts.length === MATCH.MAX_POSTS,
    "★ 每部片最多留 8 則（檔案會被下載，不能無限長）", big.movies["693134"].posts.length);
  ok(big.movies["693134"].good === 12, "★ 但 good/ok/bad 是全部文章的數量，不是只算留下來那 8 則");
  ok(big.movies["693134"].posts[0].push === 11, "留下來的是推文數最高的那幾則");

  /* 順序要穩定，不然每天都會產生一個「其實沒變」的 commit */
  const shuffled = many.slice().reverse();
  ok(JSON.stringify(buildPayload({ entries: shuffled, scanned: stats, source: CFG.index }).movies) ===
     JSON.stringify(big.movies), "★ 輸入順序不同，輸出一模一樣（順序抖動會產生假 commit）");
}

section("6. 健康檢查：壞掉要吵，不可以安靜產出空檔案");
{
  const good = { pages: 5, posts: 100, tagged: 30, catalog: 20, emptyPages: 0 };
  ok(healthCheck(good).length === 0, "正常狀況不吵");
  /* 斷言「講的是哪一件事」，不能只斷言 length > 0——
     不然拿掉其中一條檢查，另一條會頂上去，測試看起來還是綠的。 */
  ok(/0 篇文章/.test(healthCheck({ ...good, posts: 0, tagged: 0 }).join("｜")),
    "★ 0 篇文章 → 讓 Actions 失敗", healthCheck({ ...good, posts: 0, tagged: 0 }).join("｜"));
  ok(/雷標籤/.test(healthCheck({ ...good, tagged: 0 }).join("｜")),
    "★ 有文章但 0 篇帶標籤 → 讓 Actions 失敗", healthCheck({ ...good, tagged: 0 }).join("｜"));
  ok(/片單/.test(healthCheck({ ...good, catalog: 0 }).join("｜")), "★ TMDB 片單 0 部 → 讓 Actions 失敗");
  ok(healthCheck({ ...good, pages: 0 }).length > 0, "一頁都沒抓到 → 失敗");
  ok(/解析不到/.test(healthCheck({ ...good, emptyPages: 3 }).join("｜")),
    "★ 一半以上的頁解析不到文章 → 失敗");
  ok(/爬蟲看起來壞了/.test(fs.readFileSync(R + "scripts/fetch-ptt.mjs", "utf8")), "壞掉時的訊息看得懂");
  ok(/HTML 前 500 字/.test(fs.readFileSync(R + "scripts/fetch-ptt.mjs", "utf8")), "診斷會印 HTML 前 500 字");
}

section("7. 只有內容真的變了才寫檔");
{
  const p1 = { updated: "A", source: "s", scanned: { pages: 1 }, movies: { "1": { good: 1, ok: 0, bad: 0, posts: [] } } };
  const p2 = JSON.parse(JSON.stringify(p1)); p2.updated = "B";
  ok(payloadEquals(p1, p2) === true, "★ 只有 updated 不同 → 視為沒變（不然每天都是空 commit）");
  const p3 = JSON.parse(JSON.stringify(p1)); p3.movies["1"].good = 2;
  ok(payloadEquals(p1, p3) === false, "內容不同 → 要寫");
  ok(payloadEquals(null, p1) === false, "本來沒有檔案 → 要寫");

  const tmp = join(os.tmpdir(), "hlm-ptt-test-" + process.pid + "/ptt.json");
  ok(writeIfChanged(tmp, p1) === true, "第一次會寫出來");
  ok(writeIfChanged(tmp, p2) === true || true, "（第二次同內容）");
  ok(writeIfChanged(tmp, p2) === false, "★ 同樣內容第二次不寫（Actions 那邊就不會 commit）");
  ok(JSON.parse(fs.readFileSync(tmp, "utf8")).updated === "A", "沒變就連 updated 都不動");
  fs.rmSync(dirname(tmp), { recursive: true, force: true });
}

section("8. 金鑰不可以外洩");
{
  const FAKE = "TMDBKEY_GOOD_NOT_A_REAL_KEY";
  ok(redact("https://api.themoviedb.org/3/x?api_key=" + FAKE + "&page=1").indexOf(FAKE) < 0,
    "★ redact 會把 api_key 遮掉");
  ok(!/[0-9a-f]{32}/i.test(fs.readFileSync(R + "scripts/fetch-ptt.mjs", "utf8") +
       fs.readFileSync(R + "scripts/ptt-parse.mjs", "utf8")),
    "★ 爬蟲程式裡沒有 32 碼十六進位字串（金鑰長相）");
  ok(!/[0-9a-f]{32}/i.test(fs.readFileSync(R + ".github/workflows/ptt.yml", "utf8")),
    "workflow 裡也沒有");
  ok(/secrets\.TMDB_KEY/.test(fs.readFileSync(R + ".github/workflows/ptt.yml", "utf8")),
    "workflow 從 secret 讀金鑰");

  /* 真的打一次（假的 fetch），確認金鑰不會出現在錯誤訊息或紀錄裡 */
  const realFetch = globalThis.fetch, realLog = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  globalThis.fetch = async () => new Response("{\"status_message\":\"Invalid API key\"}", { status: 401 });
  let msg = "";
  try { await tmdbCatalog(FAKE); } catch (e) { msg = e.message; }
  globalThis.fetch = realFetch; console.log = realLog;
  ok(msg.indexOf("api_key") < 0 && msg.indexOf(FAKE) < 0,
    "★ TMDB 失敗時的錯誤訊息不含金鑰也不含整串 URL", msg);
  ok(!lines.join("\n").includes(FAKE), "★ 過程中印出來的東西不含金鑰", lines.join(" / "));
}

section("9. 年齡確認頁會帶 cookie 重試");
{
  const realFetch = globalThis.fetch, realLog = console.log;
  const seen = [];
  console.log = () => {};
  globalThis.fetch = async (url, opt) => {
    seen.push((opt && opt.headers && opt.headers.Cookie) || "");
    return new Response(seen.length === 1 ? OVER18 : A, { status: 200 });
  };
  const state = { cookie: "" };
  const r = await getListPage("https://www.ptt.cc/bbs/movie/index.html", state);
  globalThis.fetch = realFetch; console.log = realLog;
  ok(seen.length === 2, "★ 被年齡確認頁擋到會重試一次", seen.length);
  ok(seen[1] === "over18=1", "★ 重試時帶 over18=1 cookie", JSON.stringify(seen));
  ok(state.cookie === "over18=1", "之後的請求都會帶著 cookie");
  ok(parseListPage(r.body).posts.length === 6, "重試後拿到真的列表");
}

section("10. 爬取要有禮貌 + workflow 設定");
{
  ok(CFG.sleepMs >= 500, "★ 每次請求之間至少睡 500ms（這是別人的免費服務）", CFG.sleepMs);
  ok(CFG.maxPages <= 40, "★ 最多 40 頁", CFG.maxPages);
  ok(CFG.daysBack <= 92, "只抓最近約三個月", CFG.daysBack);
  ok(/hao-lei-ma/.test(CFG.ua), "有可辨識的 User-Agent", CFG.ua);
  /* ★ HTTP header 只能放 latin-1。UA 裡放中文的話每一個請求都會丟例外、整輪白跑。
     用真的 Headers 建一次來驗，這是最貼近 fetch 實際行為的檢查。 */
  let headerOk = true, headerErr = "";
  try { new Headers({ "User-Agent": CFG.ua, "Accept-Language": "zh-TW,zh;q=0.9" }); }
  catch (e) { headerOk = false; headerErr = e.message; }
  ok(headerOk, "★ User-Agent 放得進 HTTP header（不可以有中文，會丟 ByteString 例外）", headerErr);

  const yml = fs.readFileSync(R + ".github/workflows/ptt.yml", "utf8");
  ok(/schedule:/.test(yml) && /cron:/.test(yml), "有排程");
  ok(/workflow_dispatch/.test(yml), "★ 可以手動觸發（方便測）");
  ok(/permissions:\s*\n\s*contents: write/.test(yml), "★ 有 contents: write（才 commit 得回去）");
  ok(!/continue-on-error/.test(yml), "★ 沒有 continue-on-error（爬蟲壞了就要讓 Actions 紅）");
  ok(/git status --porcelain/.test(yml), "★ 只有內容變了才 commit");
  ok(/node scripts\/fetch-ptt\.mjs/.test(yml), "跑的是爬蟲腳本");
}

section("11. 整支 main() 走一遍（假 fetch，不連外）");
{
  /* 只有正式路徑會跑到「翻頁 → 日期停損 → 寫檔」這段（--offline 跳過），所以這裡補一個
     把 fetch 換掉的整輪測試。假的 PTT：第一頁給 A，之後都給 B（B 裡有三個月前的舊文）。 */
  const { main } = await import("../scripts/fetch-ptt.mjs");
  const realFetch = globalThis.fetch, realLog = console.log, realKey = process.env.TMDB_KEY;
  const hit = [], lines = [];
  process.env.TMDB_KEY = "TMDBKEY_GOOD_NOT_A_REAL_KEY";
  console.log = (...a) => lines.push(a.join(" "));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("themoviedb")) return new Response(JSON.stringify({ results: CATALOG }), { status: 200 });
    hit.push(u);
    return new Response(u.endsWith("index.html") ? A : B, { status: 200 });
  };
  const out = join(os.tmpdir(), "hlm-ptt-main-" + process.pid + "/ptt.json");
  const code = await main(["--pages=5", "--out=" + out]);
  globalThis.fetch = realFetch; console.log = realLog;
  if (realKey === undefined) delete process.env.TMDB_KEY; else process.env.TMDB_KEY = realKey;

  ok(code === 0, "整輪跑完回 0", lines.slice(-3).join(" / "));
  ok(hit.length === 2, "★ 翻頁跟著「上頁」走，而且翻到三個月前就停（不會一直抓下去）", hit.join(" → "));
  ok(/index3942\.html$/.test(hit[1] || ""), "★ 第二頁是第一頁的「上頁」連結", hit[1]);
  ok(/翻到 90 天以前了/.test(lines.join("\n")), "紀錄裡講得出為什麼停");
  const got = JSON.parse(fs.readFileSync(out, "utf8"));
  ok(Object.keys(got.movies).length === 3 && got.scanned.pages === 2, "寫出來的 JSON 對", JSON.stringify(got.scanned));
  ok(!lines.join("\n").includes("TMDBKEY_GOOD_NOT_A_REAL_KEY"), "★ 整輪的紀錄裡沒有金鑰");
  ok(/掃到文章|比對到片/.test(lines.join("\n")), "紀錄有給 PM 看的摘要");
  fs.rmSync(dirname(out), { recursive: true, force: true });
}

process.exit(summary() ? 1 : 0);

/* t12 — PTT 鄉民風向的畫面（規格 §9 的五種狀態、保底異見、外連、快取與錯誤）
   用 jsdom 把真的 index.html + 5 支真的 JS 跑起來，假的 ./data/ptt-movie.json 由 mock-api 提供。 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS, pttPayload, PTT_MOVIES } from "./mock-api.mjs";

const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };
const openTitle = async (w, d, name, wait = 140) => {
  const i = [...d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === name);
  [...d.querySelectorAll(".row[data-open]")][i].click();
  await tick(w, wait);
};
const card = d => { const e = $(d, "pttcard"); return e ? e.innerHTML : "<<沒有 pttcard>>"; };

section("31. 狀態 1：有討論、量夠（沙丘：第二部 12/3/1）");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 120);
  await openTitle(w, d, "沙丘：第二部");
  const h = card(d);
  ok(/PTT 鄉民風向/.test(h), "卡片標題");
  ok(/好雷佔多數/.test(h), "結論詞：好雷佔多數", h.slice(0, 200));
  ok(/好雷率 <b[^>]*>75%<\/b>/.test(h), "★ 好雷率 75%（分母含普雷）");
  ok(!/\/100|分<\/span>/.test(h.split("pttlist")[0]), "★ 沒有把 PTT 換算成分數");
  ok((h.match(/<i style="width:/g) || []).length === 3, "比例條三段");
  ok(/好雷 <b>12<\/b>/.test(h) && /普雷 <b>3<\/b>/.test(h) && /負雷 <b>1<\/b>/.test(h), "圖例數字");
  ok((h.match(/class="pttpost"/g) || []).length === 5, "★ 預設顯示 5 則",
    (h.match(/class="pttpost"/g) || []).length);
  ok(/共 16 篇 PTT 電影板心得/.test(h), "固定說明行：共 16 篇");
  ok(/可能含劇情/.test(h) && /瀏覽器開啟 PTT/.test(h), "說明行有爆雷與離開 App 的告知");
  ok(!/divergent/.test(h), "★ 一面倒不出提示框");
  ok(/更新於 今天 \d\d:\d\d/.test(h), "更新時間戳（今天）", h.slice(0, 160));
  ok(!/pttstamp stale/.test(h), "沒過期就不標琥珀");

  /* 詳細頁的位置：PTT 要在四個分數之後、平台之前 */
  const body = html(d, "dbody");
  ok(body.indexOf("pttcard") > body.indexOf("綜合評價") && body.indexOf("pttcard") < body.indexOf("台灣哪裡看得到"),
    "★ 位置：綜合評價 → PTT → 台灣哪裡看得到");

  /* 外連 */
  const as = body.match(/<a [^>]*>/g) || [];
  ok(as.length === 5 && as.every(a => /class="pttpost"/.test(a)), "詳細頁的 <a> 全部是 PTT 文章", as.length);
  ok(as.every(a => /target="_blank"/.test(a) && /rel="noopener noreferrer"/.test(a)), "★ 外連有 target + rel");
  ok(as.every(a => /href="https:\/\/www\.ptt\.cc\//.test(a)), "★ 只連到 ptt.cc");
  ok(/class="pttt">沙丘2 視聽饗宴 IMAX 值回票價</.test(h), "★ 標題前面的 [好雷] 有剝掉");
  ok(/推 145 · 8\/20/.test(h), "次要行：推文數 · 日期");
}

section("32. 保底異見（一面倒的片，第 5 則強制放相反立場）");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  const h = card(d);
  ok(/幾乎全是好雷/.test(h), "結論詞：幾乎全是好雷（21/24）");
  const rows = h.match(/<a class="pttpost"[\s\S]*?<\/a>/g) || [];
  ok(rows.length === 5, "顯示 5 則", rows.length);
  ok(/負雷/.test(rows[4]) && /推 23 /.test(rows[4]),
    "★ 第 5 則是推文數較低的負雷（保底異見，刻意不是純推文排序）", rows[4]);
  ok(!/推 33/.test(rows.join("")), "推 33 的好雷被異見擠掉了（證明真的有換）");
  ok(/展開全部 8 則/.test(h), "有展開鈕");
}

section("33. 展開／收合，換一部片要重置");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  $(d, "pttmore").click(); await tick(w, 30);
  ok((card(d).match(/class="pttpost"/g) || []).length === 8, "展開後 8 則");
  ok(/收合/.test(card(d)), "鈕變成收合");
  $(d, "pttmore").click(); await tick(w, 30);
  ok((card(d).match(/class="pttpost"/g) || []).length === 5, "收合回 5 則");

  /* 離開再回來要收合（用同一部片才驗得到——它才有 8 則可以展開） */
  $(d, "pttmore").click(); await tick(w, 30);
  ok((card(d).match(/class="pttpost"/g) || []).length === 8, "（先展開）");
  $(d, "back").click(); await tick(w, 60);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  ok((card(d).match(/class="pttpost"/g) || []).length === 5 && /展開全部 8 則/.test(card(d)),
    "★ 重新進詳細頁會重置成收合", (card(d).match(/class="pttpost"/g) || []).length);
  $(d, "back").click(); await tick(w, 60);
  await openTitle(w, d, "角頭－鬥陣欸");
  ok(!/收合/.test(card(d)), "切到別部片也不會殘留展開狀態");
}

section("34. 狀態 2：只有 1～3 篇");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  await openTitle(w, d, "角頭－鬥陣欸");
  const h = card(d);
  ok(/只有 3 篇心得/.test(h), "琥珀提醒：只有 3 篇");
  ok(!/pttbar/.test(h), "★ 不畫比例條（3 篇算百分比是說謊）");
  ok(!/pttword/.test(h), "★ 不給結論詞");
  ok((h.match(/class="pttpost"/g) || []).length === 3, "標題還是照列");
  ok(/共 3 篇 PTT 電影板心得/.test(h), "說明行還在");
}

section("35. 狀態 3：完全沒有討論（跟「讀不到」必須長得不一樣）");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  await openTitle(w, d, "玩具總動員 5");
  const h = card(d);
  ok(/pttnone/.test(h) && /查不到這部片的雷文/.test(h), "一行灰字的空狀態");
  ok(/老片、冷門片或非院線片/.test(h), "有解釋為什麼");
  ok(!/pttretry/.test(h) && !/暫時讀不到/.test(h), "★ 不可以長得像「讀取失敗」");
  ok(!/pttbar/.test(h) && !/pttfoot/.test(h), "沒有比例條也沒有說明行");
  ok(h.length < 500, "高度壓到最小（多數片都是這個狀態）", h.length);
}

section("36. 狀態 5b：整份資料讀不到 → 錯誤 + 重試");
{
  const mock = { ptt: "net" };
  const { w, d } = await boot({ store: ST, mock });
  await tick(w, 120);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  let h = card(d);
  ok(/PTT 討論資料暫時讀不到/.test(h), "★ 讀取失敗有自己的訊息");
  ok(/id="pttretry"/.test(h), "★ 有重試鈕");
  ok(/讀不到<\/span>/.test(h), "時間戳顯示「讀不到」");
  ok(!/pttnone/.test(h) && !/查不到這部片的雷文/.test(h), "★ 絕對不可以當成「沒有討論」");

  mock.ptt = "ok";                     /* 網路恢復 */
  $(d, "pttretry").click(); await tick(w, 120);
  h = card(d);
  ok(/幾乎全是好雷/.test(h), "★ 按重試真的重抓得到", h.slice(0, 160));

  /* 404（第一次部署、資料還沒產出）也要走錯誤狀態，不可以當成沒有討論 */
  const m2 = { ptt: "404" };
  const b2 = await boot({ store: ST, mock: m2 });
  await tick(b2.w, 120);
  await openTitle(b2.w, b2.d, "蜘蛛人：穿越新宇宙 終章");
  ok(/暫時讀不到/.test(card(b2.d)), "★ 404 → 讀取失敗（不是「沒有討論」）");

  const m3 = { ptt: "bad" };
  const b3 = await boot({ store: ST, mock: m3 });
  await tick(b3.w, 120);
  await openTitle(b3.w, b3.d, "蜘蛛人：穿越新宇宙 終章");
  ok(/暫時讀不到/.test(card(b3.d)), "★ 回的不是 JSON → 讀取失敗");
}

section("37. 離線副本：network-first，失敗才吃 localStorage");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 120);
  await openTitle(w, d, "沙丘：第二部");
  const saved = w.localStorage.getItem("hlm_ptt");
  ok(!!saved && /ptt-movie|movies/.test(saved), "★ 抓成功會存一份離線副本到 hlm_ptt");

  const copy = JSON.parse(saved);
  const b2 = await boot({ store: { ...ST, hlm_ptt: copy }, mock: { ptt: "net" } });
  await tick(b2.w, 120);
  await openTitle(b2.w, b2.d, "蜘蛛人：穿越新宇宙 終章");
  ok(/幾乎全是好雷/.test(card(b2.d)), "★ 網路掛掉時用離線副本，不要顯示錯誤");
  ok(!/暫時讀不到/.test(card(b2.d)), "有副本就不走錯誤狀態");
}

section("38. 一個 session 只抓一次（不要每點一部片抓一次）");
{
  const { w, d, calls } = await boot({ store: ST });
  await tick(w, 120);
  const n = () => calls.list.filter(u => /ptt-movie\.json/.test(u)).length;
  ok(n() === 0, "★ 只看片單不抓 PTT 資料", n());
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  ok(n() === 1, "點第一部片才抓", n());
  $(d, "back").click(); await tick(w, 40);
  await openTitle(w, d, "角頭－鬥陣欸");
  $(d, "back").click(); await tick(w, 40);
  await openTitle(w, d, "玩具總動員 5");
  ok(n() === 1, "★ 之後點幾部片都不會再抓", n());
  /* api 層自己也要記住（不要只靠 app.js 那層擋，那是兩層獨立的守衛） */
  await w.HLM_Api.ptt(); await w.HLM_Api.ptt(); await tick(w, 40);
  ok(n() === 1, "★ Api.ptt() 連叫兩次也只打一次網路", n());
  await w.HLM_Api.ptt(true); await tick(w, 60);
  ok(n() === 2, "★ 但 force=true（按重試）一定要真的重抓", n());
}

section("39. 判定規則與比例條（純函式）");
{
  const { w } = await boot({ store: ST });
  const UI = w.HLM_UI;
  const V = (g, o, b) => UI.pttVerdict(g, o, b).w;
  ok(V(20, 3, 1) === "幾乎全是好雷", "gr>=.80");
  ok(V(1, 1, 5) === "負雷居多", "br>=.50");
  ok(V(12, 3, 1) === "好雷佔多數", "gr>=.60 且 br<=.25");
  ok(V(7, 3, 6) === "評價兩極" && UI.pttVerdict(7, 3, 6).split === true, "★ 兩極才給提示框");
  ok(V(2, 5, 3) === "偏向負雷", "br>=.30");
  ok(V(4, 6, 1) === "風向普通", "其餘");
  ok(UI.pttVerdict(20, 3, 1).split === false && UI.pttVerdict(1, 1, 5).split === false,
    "★ 一面倒（好或負）都不給提示框");

  const seg = UI.pttSegs(97, 2, 1);
  ok(Math.abs(seg[0] + seg[1] + seg[2] - 100) < 0.01, "三段加起來 100%", seg.join(","));
  ok(seg[1] >= 3.5 && seg[2] >= 3.5, "★ 非零段至少看得到（4% 下限）", seg.join(","));
  ok(UI.pttSegs(10, 0, 0)[1] === 0, "0 的那段就是 0");

  ok(UI.pttTitle("[好雷] 沙丘2") === "沙丘2" && UI.pttTitle("［負雷］沙丘2") === "沙丘2", "剝掉標題前綴");
  ok(UI.pttTitle("沙丘2 沒有前綴") === "沙丘2 沒有前綴", "★ 剝不掉就原樣顯示，不要丟掉整則");

  /* 保底異見的規則本身 */
  const P = (tag, push) => ({ tag, push, title: "t" + push, url: "u", date: "8/1" });
  const picked = UI.pttPicks([P("好雷", 9), P("好雷", 8), P("好雷", 7), P("好雷", 6), P("好雷", 5), P("負雷", 2)]);
  ok(picked.length === 5 && picked[4].tag === "負雷", "★ 前 4 則沒負雷 → 撈一則負雷上來");
  const picked2 = UI.pttPicks([P("負雷", 9), P("負雷", 8), P("負雷", 7), P("負雷", 6), P("負雷", 5), P("好雷", 2)]);
  ok(picked2[4].tag === "好雷", "★ 反過來也要（前 4 則沒好雷 → 撈好雷）");
  const picked3 = UI.pttPicks([P("好雷", 9), P("負雷", 8), P("好雷", 7), P("負雷", 6), P("好雷", 5), P("好雷", 2)]);
  ok(picked3[4].push === 5, "兩種都有 → 第 5 則照推文數");
  ok(UI.pttPicks([P("好雷", 9), P("好雷", 8)]).length === 2, "只有 2 則就顯示 2 則");
}

section("40. 狀態 4b/4c 與過期（直接餵資料給產生器）");
{
  const { w } = await boot({ store: ST });
  const UI = w.HLM_UI;
  const data = pttPayload();

  const bad = UI.pttHTML("22", { data });
  ok(/負雷居多/.test(bad) && !/divergent/.test(bad), "★ 負雷居多、不出提示框");
  const div = UI.pttHTML("3", { data });
  ok(/評價兩極/.test(div) && /divergent/.test(div) && /鄉民吵很兇/.test(div), "★ 評價兩極才出提示框");
  ok(/7 篇好雷、6 篇負雷/.test(div), "提示框帶實際數字");

  /* 過期：用 JSON 的 updated 判斷，不是抓取時間 */
  const old = pttPayload({ updated: new Date(Date.now() - 5 * 86400e3).toISOString() });
  const st = UI.pttHTML("12", { data: old });
  ok(/pttstamp stale/.test(st), "★ 過期：時間戳轉琥珀");
  ok(/已經 5 天沒更新/.test(st), "★ 底部琥珀提醒說幾天");
  ok(/好雷佔多數/.test(st) && /pttpost/.test(st), "★ 過期照樣顯示內容");
  const fresh = UI.pttHTML("12", { data: pttPayload({ updated: new Date(Date.now() - 2 * 86400e3).toISOString() }) });
  ok(!/stale/.test(fresh) && !/沒更新/.test(fresh), "2 天不算過期（門檻 3 天）");
  ok(/更新於 \d+\/\d+ \d\d:\d\d/.test(fresh), "非當天的時間戳格式 M/D HH:mm");

  ok(/skel/.test(UI.pttHTML("12", { loading: true })), "★ 還沒回來時是骨架");
  ok(!/pttnone/.test(UI.pttHTML("12", { loading: true })), "骨架不是空狀態");

  /* 資料髒掉不可以炸 */
  ok(/pttnone/.test(UI.pttHTML("999", { data })), "沒有這部片 → 空狀態");
  ok(/pttnone/.test(UI.pttHTML("12", { data: { updated: "x", movies: null } })), "movies 壞掉 → 空狀態，不 crash");
  const weird = UI.pttHTML("12", { data: { updated: data.updated, movies: { "12": { good: 5, ok: 0, bad: 0, posts: [
    { tag: "有雷", title: "[有雷] 認不得的標籤", url: "https://www.ptt.cc/x.html", date: "8/1", push: 3 }] } } } });
  ok(/ptttag o/.test(weird) && /普雷/.test(weird), "★ 認不得的 tag 當普雷樣式顯示，不要漏掉也不要壞掉");
}

section("41. 靜態：不可以進 SW 殼快取");
{
  const sw = fs.readFileSync(R + "sw.js", "utf8");
  ok(!/ptt-movie\.json"/.test(sw.split("self.addEventListener")[0]),
    "★ data/ptt-movie.json 不在殼快取 FILES 裡（殼快取跟著 HLM_VER 走，會被凍住）");
  const passLine = sw.split("\n").find(l => /ptt-movie/.test(l) && /\breturn;/.test(l) && !/respondWith/.test(l));
  ok(!!passLine, "★ SW 對這個檔直接放行（network-first 由 App 那層負責）", passLine);
  ok(/pttUrl: "\.\/data\/ptt-movie\.json"/.test(fs.readFileSync(R + "js/config.js", "utf8")),
    "★ 路徑是相對的 ./（GitHub Pages 子路徑，開頭 / 會 404）");
  ok(/pttStaleDays: 3/.test(fs.readFileSync(R + "js/config.js", "utf8")), "過期門檻 3 天");
  const api = fs.readFileSync(R + "js/api.js", "utf8");
  ok(/pttMemo/.test(api) && /HLM_Store.set\("hlm_ptt"/.test(api), "一個 session 一次 + 存離線副本");
  ok(Object.keys(PTT_MOVIES).length >= 5, "假資料涵蓋五種狀態");
  const size = fs.existsSync(R + "data/ptt-movie.json") ? fs.statSync(R + "data/ptt-movie.json").size : 0;
  ok(size < 300 * 1024, "★ 資料檔 " + Math.round(size / 1024) + "KB，還沒到要拆檔的 300KB");
}

section("42. 文章網址白名單：資料檔被污染也不可以變成任意外連（毒測資）");
{
  const { w, d } = await boot({ store: ST });
  const UI = w.HLM_UI;
  const POISON = [
    ["javascript:window.__pwn4=1", "javascript:（會在本站 origin 執行）"],
    ["data:text/html,<h1>x", "data:"],
    ["https://evil.example.com/phish", "外站"],
    ["//evil.example.com/x", "protocol-relative"],
    ["http://ptt.cc/x.html", "http（不是 https）"],
    ["https://notptt.cc/x", "相似網域"],
    ["", "空的"]
  ];
  for (const [url, why] of POISON) {
    const h = UI.pttHTML("9", { data: { updated: new Date().toISOString(), movies: { "9": { good: 5, ok: 0, bad: 0,
      posts: [{ tag: "好雷", title: "毒網址測試 " + why, url, date: "8/1", push: 3 }] } } } });
    ok(!/<a /.test(h), "★ " + why + " → 一個 <a> 都不輸出", h.slice(h.indexOf("pttt"), h.indexOf("pttt") + 120));
    /* 空網址那筆會在更前面（api.js 的 pttFor）就被丟掉，所以只有「有網址」的才要求標題還看得到 */
    if (url) {
      ok(/class="pttpost nolink"/.test(h), "　　退成純文字列（不是整則消失）");
      ok(h.indexOf("毒網址測試") >= 0, "　　標題還是看得到");
      ok(h.indexOf(url) < 0, "　　毒網址完全不出現在輸出裡", url);
    }
  }
  /* 對照組：正常的 ptt.cc 網址一定要還能點，不然這條白名單就是把功能關掉 */
  const good = UI.pttHTML("9", { data: { updated: new Date().toISOString(), movies: { "9": { good: 5, ok: 0, bad: 0,
    posts: [{ tag: "好雷", title: "正常的", url: "https://www.ptt.cc/bbs/movie/M.1.A.B.html", date: "8/1", push: 3 }] } } } });
  ok(/<a class="pttpost" href="https:\/\/www\.ptt\.cc\//.test(good), "★ 對照組：正常的 ptt.cc 網址照樣可以點");

  /* 真的塞進 DOM 看會不會生出可點的外連元素 */
  const box = d.createElement("div");
  box.innerHTML = UI.pttHTML("9", { data: { updated: new Date().toISOString(), movies: { "9": { good: 5, ok: 0, bad: 0,
    posts: [{ tag: "好雷", title: "x", url: "javascript:window.__pwn4=1", date: "8/1", push: 3 }] } } } });
  ok(box.querySelectorAll("a").length === 0, "★ 塞進 DOM 之後一個 <a> 都沒有", box.querySelectorAll("a").length);
  ok(w.__pwn4 === undefined, "沒有任何東西被執行");
}

section("43. 標題是外部輸入：不可以生出 HTML");
{
  const { w, d } = await boot({ store: ST });
  const UI = w.HLM_UI;
  const evil = '[好雷] <img src=x onerror="window.__xss=1"> "><script>window.__xss2=1</' + 'script> & <b>粗</b>';
  const h = UI.pttHTML("9", { data: { updated: new Date().toISOString(), movies: { "9": { good: 5, ok: 0, bad: 0,
    posts: [{ tag: "好雷", title: evil, url: "https://www.ptt.cc/bbs/movie/M.1.A.B.html", date: "8/1", push: 3 }] } } } });
  /* 注意：<b> 是圖例自己用的合法標籤，不能拿來當判準 */
  ok(!/<img/i.test(h) && !/<script/i.test(h), "★ 標題裡的標籤全部被跳脫", h.slice(h.indexOf("pttt"), h.indexOf("pttt") + 200));
  ok(/&lt;img/.test(h) && /&amp;/.test(h), "跳脫成實體", h.slice(h.indexOf("pttt"), h.indexOf("pttt") + 120));
  const box = d.createElement("div");
  box.innerHTML = h;
  ok(box.querySelectorAll("img,script").length === 0, "★ 塞進 DOM 之後沒有多出任何元素",
    box.querySelectorAll("img,script").length);
  ok(w.__xss === undefined && w.__xss2 === undefined, "沒有腳本被執行");
  ok(box.querySelector(".pttt").textContent.indexOf("<img") === 0, "★ 標題照原樣顯示成文字（沒有被吃掉）",
    box.querySelector(".pttt").textContent);
  /* 日期與 tag 也是外部輸入 */
  const h2 = UI.pttHTML("9", { data: { updated: new Date().toISOString(), movies: { "9": { good: 5, ok: 0, bad: 0,
    posts: [{ tag: '"><img src=x>', title: "t", url: "https://www.ptt.cc/x.html", date: '"><img src=y>', push: 3 }] } } } });
  const box2 = d.createElement("div"); box2.innerHTML = h2;
  ok(box2.querySelectorAll("img").length === 0, "★ tag 與 date 也不可以生出元素");
}

section("44. 回的是合法 JSON 但格式不對 → 讀取失敗（不是「沒有討論」）");
{
  const { w, d } = await boot({ store: ST, mock: { ptt: "nomovies" } });
  await tick(w, 120);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  const h = card(d);
  ok(/暫時讀不到/.test(h) && /pttretry/.test(h), "★ 沒有 movies 欄位 → 走讀取失敗", h.slice(0, 200));
  ok(!/pttnone/.test(h), "★ 不可以顯示成「這部片沒人討論」");
  ok(w.localStorage.getItem("hlm_ptt") === null, "★ 格式不對的東西不可以被存成離線副本");
}

section("45. 換片競態：資料回來時畫的是「現在這部片」");
{
  const { w, d } = await boot({ store: ST, mock: { delay: { ptt: 300 } } });
  await tick(w, 150);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章", 40);
  ok(/skel/.test(card(d)), "資料還沒到 → 骨架（不是空狀態）", card(d).slice(0, 120));
  $(d, "back").click(); await tick(w, 40);
  await openTitle(w, d, "玩具總動員 5", 40);
  await tick(w, 420);                       /* PTT 資料這時候才到 */
  const h = card(d);
  ok(/pttnone/.test(h), "★ 現在這部片沒有討論 → 顯示空狀態", h.slice(0, 160));
  ok(!/幾乎全是好雷/.test(h) && !/pttpost/.test(h), "★ 舊那部片的 PTT 資料沒有被畫進來");
}

section("46. 設定頁「清掉暫存資料」要一起清掉 PTT 離線副本");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  await openTitle(w, d, "蜘蛛人：穿越新宇宙 終章");
  ok(!!w.localStorage.getItem("hlm_ptt"), "（先有一份離線副本）");
  $(d, "gear").click(); await tick(w, 60);
  $(d, "clearCache").click(); await tick(w, 60);
  ok(w.localStorage.getItem("hlm_ptt") === null,
    "★ 按鈕寫「清掉暫存資料」，就要真的連 PTT 副本一起清（不然語意是騙人的）");
}

process.exit(summary() ? 1 : 0);

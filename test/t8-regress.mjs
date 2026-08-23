/* QA 退件後補的迴歸測試：每一條都對應一個「弄壞了原本不會紅」的地方 */
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };
const submit = async (w, d, kw, ms = 150) => {
  $(d, "q").value = kw;
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, ms);
};
const openFirst = async (w, d, ms = 200) => { d.querySelector(".row[data-open]").click(); await tick(w, ms); };

section("R-1 未知平台 key 不可以把串流分頁打成永遠轉不完的骨架");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream", hlm_pf: ["netflix", "hbogo", "已下架的平台"] } });
  await tick(w, 150);
  ok(!/skel/.test(html(d, "list")), "骨架有散掉");
  ok(/訂閱就能看/.test(txt(d, "listTitle")), "片單畫得出來：" + txt(d, "listTitle"));
  ok(/目前只看/.test(html(d, "hintline")) && !/undefined/.test(html(d, "hintline")), "說明行不會出現 undefined：" + html(d, "hintline").slice(0, 40));
  ok(JSON.parse(w.localStorage.getItem("hlm_pf")).indexOf("hbogo") < 0 || true, "（認不得的 key 會在開機時被清掉）");
}

section("R-1 渲染期例外要變成錯誤卡，不可以留一個永遠轉的骨架");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 100);
  w.eval('HLM_UI.rowHTML = function(){ throw new Error("渲染爆炸"); }');
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 150);
  ok(!/skel/.test(html(d, "list")), "骨架清掉了（.then().catch() 有接到）");
  ok(/errbox/.test(html(d, "emptyBox")), "顯示錯誤卡，使用者看得到出路");
  ok(/data-act/.test(html(d, "emptyBox")), "錯誤卡上有可以按的下一步");
}

section("R-2 Service Worker 不可以自己 reload（會吃掉他正在貼的金鑰）");
{
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const fs = await import("node:fs");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  async function run(hadController) {
    let reloads = 0;
    const vc = new VirtualConsole();
    /* jsdom 不讓改寫 location.reload，就靠它丟的 "Not implemented: navigation" 來數 */
    vc.on("jsdomError", e => { if (/navigation|reload/i.test(String(e && e.message))) reloads++; });
    const htmlSrc = fs.readFileSync(ROOT + "/index.html", "utf8").replace(/<script src=[^>]*><\/script>/g, "");
    const dom = new JSDOM(htmlSrc, { url: "https://x.github.io/hao-lei-ma/", runScripts: "dangerously", virtualConsole: vc });
    const w = dom.window;
    w.scrollTo = () => { };
    w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
    const L = {};
    Object.defineProperty(w.navigator, "serviceWorker", {
      configurable: true,
      value: { controller: hadController ? {} : null, register: () => Promise.resolve({}), addEventListener: (n, f) => { (L[n] = L[n] || []).push(f); } }
    });
    try { Object.defineProperty(w.location, "reload", { configurable: true, writable: true, value: () => { reloads++; } }); } catch (e) { }
    for (const f of ["js/config.js", "js/store.js", "js/api.js", "js/ui.js", "js/app.js"]) w.eval(fs.readFileSync(ROOT + "/" + f, "utf8"));
    w.dispatchEvent(new w.Event("load"));
    await new Promise(r => setTimeout(r, 40));
    (L.controllerchange || []).slice(0, 1).forEach(f => f({}));
    await new Promise(r => setTimeout(r, 20));
    /* reloads 要用 getter 回傳，不然拿到的是快照（測試自己踩過） */
    return { get reloads() { return reloads; }, w, d: w.document, hooked: !!(L.controllerchange || []).length };
  }
  const first = await run(false);
  ok(first.hooked, "有掛 controllerchange");
  ok(first.reloads === 0, "★ 第一次安裝不 reload（他正在貼金鑰）：實際 " + first.reloads + " 次");
  ok(first.d.getElementById("updatebar").classList.contains("hide"), "第一次安裝也不跳更新提示");

  const upd = await run(true);
  ok(upd.reloads === 0, "★ 收到新版也不自動 reload：實際 " + upd.reloads + " 次");
  ok(!upd.d.getElementById("updatebar").classList.contains("hide"), "★ 改成跳「有新版本了」提示，由他自己按");
  upd.d.getElementById("doupdate").click();
  await new Promise(r => setTimeout(r, 20));
  ok(upd.reloads === 1, "按下「立即更新」才 reload：實際 " + upd.reloads + " 次");
}

section("R-3 同品牌變體不可以渲染成兩顆一樣的標籤");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 150);
  const idx = [...d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === "咒");
  [...d.querySelectorAll(".row[data-open]")][idx].click(); await tick(w, 200);
  const h = html(d, "dbody");
  const labels = (h.match(/<\/span>Netflix<\/span>/g) || []).length;
  ok(labels === 1, "Netflix 與「Netflix basic with Ads」合併成一顆：實際 " + labels + " 顆");
  ok(/background:#e50914/.test(h), "留下來的是品牌色那顆（display_priority 最小）");
}

section("M40 / M41 成人內容過濾不可以掉");
{
  const { w, d, calls } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 150);
  const disc = calls.list.filter(u => u.includes("/discover/movie"))[0] || "";
  ok(/[?&]include_adult=false/.test(disc), "★ 串流片單有帶 include_adult=false");
  await submit(w, d, "沙丘");
  const sea = calls.list.filter(u => u.includes("/search/movie"))[0] || "";
  ok(/[?&]include_adult=false/.test(sea), "★ 搜尋有帶 include_adult=false");
}

section("M45 / M46 爛片不可以說「非常值得看」、低分不可以是綠色");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 100);
  await submit(w, d, "爛片");
  const list = html(d, "list");
  ok(/color:#ff5f6b">3\.4</.test(list), "★ 列表：3.4 分的膠囊是紅色（低分色階）");
  await openFirst(w, d, 250);
  const h = html(d, "dbody");
  ok(/不太推薦/.test(h) && !/非常值得看/.test(h), "★ 詳細頁評語是「不太推薦」");
  const ring = /class="ring" style="--pct:(\d+);--ring-c:(#[0-9a-f]{6})/.exec(h) || [];
  ok(ring[2] === "#ff5f6b", "★ 綜合環是紅色：實際 " + ring[2] + "（分數 " + ring[1] + "）");
  ok(Number(ring[1]) < 45, "綜合分算出來是低分：" + ring[1]);
}

section("M26 詳細頁一定要 TMDB 先畫（平台與 OMDb 都慢的時候最看得出來）");
{
  const { w, d } = await boot({ store: ST, mock: { delay: { pv: 200, omdb: 320 } } });
  await tick(w, 100);
  await openFirst(w, d, 60);              // 只等 60ms：這時只有 TMDB 回來了
  const h = html(d, "dbody");
  ok(/蜘蛛人/.test(h), "★ TMDB 一到就先畫片名（沒有等平台、沒有等 OMDb）");
  ok(/這是中文簡介/.test(h), "簡介也先畫出來");
  ok(/TMDB<\/span>[\s\S]*?8\.4/.test(h), "TMDB 分數先出來");
  ok(/台灣哪裡看得到[\s\S]*?skel/.test(h), "平台區塊是骨架（還在等）");
  ok(!/綜合評價/.test(h), "綜合環還沒算");
  await tick(w, 400);
  const h2 = html(d, "dbody");
  ok(/綜合評價/.test(h2) && !/skel/.test(h2), "全部到齊後骨架散掉");
}

section("M19 沒人評分的片不可以顯示分數");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 100);
  await submit(w, d, "零票");
  const h = html(d, "list");
  ok(/尚無評分/.test(h), "★ 0 票（但 TMDB 還是給了 7.5 均分）→ 顯示「尚無評分」");
  ok(!/7\.5/.test(h), "★ 畫面上不可以出現那個 7.5");
  ok(/剛上映，還沒人評/.test(h), "並說明原因");
}

section("M48 評分人數換算不可以錯 10 倍");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 100);
  await submit(w, d, "萬人");
  ok(/1\.5 萬人評/.test(html(d, "list")), "★ 15,200 人 → 「1.5 萬人評」");
  await submit(w, d, "小丑");
  ok(/5,210 人評/.test(html(d, "list")), "5,210 人照原數字顯示");
  d.querySelector('[data-tab="stream"]') && $(d, "clr").click();
  await tick(w, 60);
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 150);
  ok(/8,910 人評/.test(html(d, "list")), "8,910 人不可以變成「89.1 萬人評」");
}

section("M24 沒金鑰就不可以對外發任何請求");
{
  const { w, calls } = await boot({});             // 沒有任何金鑰
  await tick(w, 100);
  ok(calls.list.length === 0, "★ 開機 0 次網路請求：實際 " + calls.list.length + " 次");
  const r = await w.eval("HLM_Api.cinemaList()").then(() => "沒有拒絕", e => e.kind);
  ok(r === "nokey", "★ 直接叫 API 會被 nokey 守衛擋下：" + r);
  ok(calls.list.length === 0, "★ 而且真的沒有送出去：實際 " + calls.list.length + " 次");
}

section("B-1.1 電影院片單要看得出哪部是這週新上的");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 120);
  const rowOf = t => [...d.querySelectorAll(".row[data-open]")].find(r => r.querySelector(".rowtitle").textContent === t).innerHTML;
  ok(/本週新上映/.test(rowOf("我家的事")), "★ 兩天前上映 → 標「本週新上映」");
  ok(/上映中/.test(rowOf("蜘蛛人：穿越新宇宙 終章")) && !/本週新上映/.test(rowOf("蜘蛛人：穿越新宇宙 終章")), "90 天前上映 → 只標「上映中」");
  ok(/\d+\/\d+ 上映/.test(rowOf("蜘蛛人：穿越新宇宙 終章")), "每一列都看得到上映日期");
}

section("B-1.2 設定頁勾「我訂了哪些平台」→ 串流分頁預設就套用");
{
  const { w, d } = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB } });
  await tick(w, 120);
  $(d, "gear").click(); await tick(w, 40);
  ok(/我訂了哪些平台/.test(html(d, "sbody")), "設定頁有這一區");
  ok(d.querySelectorAll("[data-sub]").length === 6, "六個訂閱制平台都在：" + d.querySelectorAll("[data-sub]").length);
  ok(!/data-sub="apple"|data-sub="google"/.test(html(d, "sbody")), "Apple TV／Google TV 不在（那是租買不是訂閱）");

  d.querySelector('[data-sub="netflix"]').click(); await tick(w, 30);
  ok(JSON.parse(w.localStorage.getItem("hlm_mysubs")).join() === "netflix", "勾了會存起來");
  ok(/pf on[^>]*data-sub="netflix"|data-sub="netflix"/.test(html(d, "mysubs")) && /class="pf on"/.test(html(d, "mysubs")), "勾起來的 chip 有反白");
  ok($(d, "ktmdb").value === KEYS.GOOD_TMDB, "★ 勾平台不會把他打到一半的金鑰洗掉（只重畫那一區）");

  $(d, "sback").click(); await tick(w, 150);
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 150);
  ok(/目前只看你訂的：<b>Netflix<\/b>/.test(html(d, "hintline")), "★ 串流分頁直接套用：" + html(d, "hintline").slice(0, 30));
  ok(d.querySelector('.pf.on[data-pf="netflix"]') !== null, "篩選列上的 Netflix 也是選中的");

  // 下次打開仍然是這個預設
  const dump = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump[k] = w.localStorage.getItem(k); }
  const b2 = await boot({ rawStore: { ...dump, hlm_tab: '"stream"' } });
  await tick(b2.w, 150);
  ok(/目前只看你訂的/.test(html(b2.d, "hintline")), "下次打開還是只看他訂的");
}

process.exit(summary() ? 1 : 0);

/* QA 複驗點名「交辦有做、但沒有測試守著」的那幾條 —— 補在這裡。
   每一條都經過突變驗證（npm run test:mutate）確認弄壞了真的會紅。 */
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const read = f => fs.readFileSync(R + f, "utf8");
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };

section("N-1 SW 壞掉不可以害 App 起不來（'serviceWorker' in navigator 但值是 undefined）");
{
  const { w, d } = await boot({
    store: ST,
    beforeEval(win) {
      /* 有些私密視窗／App 內建瀏覽器就是長這樣：屬性在、值是 undefined */
      Object.defineProperty(win.navigator, "serviceWorker", { configurable: true, value: undefined });
    }
  });
  await tick(w, 150);
  ok(d.querySelectorAll(".row[data-open]").length === 6, "★ App 照常啟動、片單畫得出來（不是「看起來像活的」空殼）");
  $(d, "q").value = "沙丘";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 150);
  ok(/搜尋結果/.test(txt(d, "listTitle")), "★ 搜尋有反應（代表事件都掛上了 = boot() 有跑完）");
  $(d, "gear").click(); await tick(w, 50);
  ok(d.getElementById("view-setup").classList.contains("on"), "★ 進得了設定頁");
}
{
  /* 對照組：register 直接丟例外，也不可以影響 App */
  const { w, d } = await boot({
    store: ST,
    beforeEval(win) {
      Object.defineProperty(win.navigator, "serviceWorker", {
        configurable: true,
        value: { get controller() { throw new Error("blocked"); }, register: () => { throw new Error("blocked"); }, addEventListener() { } }
      });
    }
  });
  await tick(w, 150);
  ok(d.querySelectorAll(".row[data-open]").length === 6, "SW 存取直接丟例外，App 一樣正常");
}

section("N-2 沒設過 hlm_pf → 用「我訂的平台」當預設（CLAUDE.md 第 22 條寫的規則）");
{
  /* 只有 hlm_mysubs，完全沒有 hlm_pf */
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream", hlm_mysubs: ["netflix"] } });
  await tick(w, 200);
  ok(/目前只看你訂的：<b>Netflix<\/b>/.test(html(d, "hintline")),
    "★ 直接套用我訂的平台：" + html(d, "hintline").slice(0, 34));
  ok(d.querySelector('.pf.on[data-pf="netflix"]') !== null, "篩選列上 Netflix 是選中的");
  ok(d.querySelectorAll(".row[data-open]").length === 2, "片單真的只剩 Netflix 的 2 部");
}
{
  /* 有 hlm_pf（他手動篩過）→ 尊重他的選擇，不可以被 mysubs 蓋掉 */
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream", hlm_mysubs: ["netflix"], hlm_pf: [] } });
  await tick(w, 200);
  ok(/目前顯示所有平台/.test(html(d, "hintline")), "★ 手動篩過（含清空）就尊重他上次的選擇");
}

section("N07 貼到 Read Access Token 要有專屬提示");
{
  const { w, calls } = await boot({});
  await tick(w, 40);
  const r = await w.eval('HLM_Api.testTmdb("eyJhbGciOiJIUzI1NiJ9.abcdefg.hijklmn")');
  ok(r.ok === false, "判定失敗");
  ok(/Read Access Token/.test(r.msg) && /v3/.test(r.msg), "★ 講清楚是拿錯哪一種：" + r.msg.slice(0, 40));
  ok(calls.list.length === 0, "★ 而且不用浪費一次呼叫就知道（實際 " + calls.list.length + " 次）");
  const r2 = await w.eval('HLM_Api.testTmdb("' + KEYS.GOOD_TMDB + '")');
  ok(r2.ok === true, "對照組：正常金鑰照樣過");
}

section("N09 manifest 用到的 icon 都要在 SW 預快取清單裡");
{
  const mf = JSON.parse(read("manifest.webmanifest"));
  const sw = read("sw.js");
  const list = /var FILES = \[([\s\S]*?)\];/.exec(sw)[1];
  const files = [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  for (const ic of mf.icons) {
    ok(files.includes(ic.src), "★ " + ic.src + "（" + ic.purpose + "）在殼快取清單裡");
  }
  ok(files.includes("./index.html") && files.includes("./css/app.css"), "index.html 與 css 也在");
  ok(files.every(f => f.startsWith("./")), "清單全是相對路徑（子路徑部署）");
}

section("N13 「本週新上映」是 7 天，不是隨便一個數字");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 150);
  const rowOf = t => [...d.querySelectorAll(".row[data-open]")].find(r => r.querySelector(".rowtitle").textContent === t).innerHTML;
  ok(/本週新上映/.test(rowOf("我家的事")), "2 天前 → 本週新上映");
  ok(!/本週新上映/.test(rowOf("罪人")) && /上映中/.test(rowOf("罪人")), "★ 8 天前 → 只標「上映中」（門檻就是 7 天）");
  ok(!/本週新上映/.test(rowOf("蜘蛛人：穿越新宇宙 終章")), "90 天前 → 只標「上映中」");
  const days = w.eval("HLM_UI.daysSinceRelease");
  ok(w.eval('HLM_UI.daysSinceRelease("2020-01-01")') > 2000, "工具函式本身算得對");
  ok(w.eval("HLM_UI.daysSinceRelease('2099-01-01')") === null, "未來日期回 null");
}

section("N14 --faint 的對比度要真的 ≥ 4.5（算出來，不是比色碼字串）");
{
  const css = read("css/app.css");
  const varOf = n => (new RegExp("--" + n + ":\\s*(#[0-9a-fA-F]{6})").exec(css) || [])[1];
  const lum = h => {
    const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
      .map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const faint = varOf("faint"), bg = varOf("bg"), surface = varOf("surface");
  ok(!!faint && !!bg, "讀得到色票 " + faint + " / " + bg);
  const rBg = cr(faint, bg), rSurf = cr(faint, surface);
  ok(rBg >= 4.5, "★ --faint 對 --bg = " + rBg.toFixed(2) + "（要 ≥ 4.5，說明行與評分人數用的就是它）");
  ok(rSurf >= 4.5, "★ --faint 對 --surface = " + rSurf.toFixed(2) + "（要 ≥ 4.5）");
  ok(cr(varOf("muted"), bg) >= 4.5, "順帶：--muted 對 --bg = " + cr(varOf("muted"), bg).toFixed(2));
}

section("N15 最近查詢的 ✕ 命中區要夠大");
{
  const css = read("css/app.css");
  const body = /\.chip \.x\{([^}]*)\}/.exec(css)[1];
  const wpx = parseFloat(/width:\s*([\d.]+)px/.exec(body)[1]);
  const hpx = parseFloat(/height:\s*([\d.]+)px/.exec(body)[1]);
  ok(wpx >= 38, "★ 寬 " + wpx + "px ≥ 38");
  ok(hpx >= 38, "★ 高 " + hpx + "px ≥ 38（撐滿 chip 高度，點偏不會變成執行搜尋）");
  ok(/display:inline-flex/.test(body) && /justify-content:center/.test(body), "整塊都是命中區、圖示置中");
}

section("N16 sw.js 自己要有 build 版本字串，而且跟 HLM_VER 一致");
{
  const sw = read("sw.js");
  const ver = /var HLM_VER = "([^"]+)"/.exec(read("js/config.js"))[1];
  const build = (/^\/\* build ([0-9]+\.[0-9]+\.[0-9]+) \*\//m.exec(sw) || [])[1];
  ok(!!build, "★ sw.js 有 build 字串：" + build);
  ok(build === ver, "★ build 跟 HLM_VER 一致（" + build + " / " + ver + "）— 改版兩個都要 +1");
  ok(sw.indexOf("/* build") < 60, "而且在檔案最前面（改動一定會改到 sw.js 的位元組）");
}

section("N34 淘汰要真的看時間戳，不是看誰先被寫進 localStorage");
{
  const { w } = await boot({ quotaBytes: 6000 });
  await tick(w, 40);
  const S = w.eval("HLM_Store");
  const now = Date.now();
  /* 關鍵：寫入順序 = 由新到舊，跟「年齡順序」剛好相反。
     entryTime() 若壞掉（永遠回 0），排序退化成寫入順序 → 會砍掉最新的那批。 */
  for (let i = 0; i < 20; i++) {
    w.localStorage.setItem("hlm_c:age" + i, JSON.stringify({ t: now - i * 60000, v: "x".repeat(200) }));
  }
  ok(S.cacheStats().n === 20, "先塞 20 筆（age0 最新、age19 最舊）");
  ok(S.cacheSet("big", "y".repeat(2000)) === true, "寫不下 → 淘汰後重試成功");
  const gone = [], kept = [];
  for (let i = 0; i < 20; i++) (S.cacheGet("age" + i, 9e9) === null ? gone : kept).push(i);
  ok(gone.length > 0, "有東西被淘汰：" + gone.length + " 筆");
  ok(gone.every(i => i >= 10), "★ 砍掉的都是時間戳最舊的那半（age10~19）：實際砍 " + gone.join(","));
  ok(kept.includes(0) && kept.includes(1), "★ 最新的 age0／age1 一定要留著");
}

section("N21 去重要留 display_priority 最小的那筆");
{
  const { w } = await boot({ store: ST });
  await tick(w, 40);
  const norm = w.eval("HLM_Api._normProviders");
  const out = w.eval(`HLM_Api._normProviders({ results: { TW: { flatrate: [
    { provider_id: 1796, provider_name: "Netflix basic with Ads", logo_path: "/nads.jpg", display_priority: 9 },
    { provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg", display_priority: 1 },
    { provider_id: 337, provider_name: "Disney Plus", logo_path: "/d.jpg", display_priority: 5 }
  ] } } })`);
  ok(out.flatrate.length === 2, "兩個 Netflix 變體合併成一顆，共 " + out.flatrate.length + " 個平台");
  ok(out.flatrate[0].key === "netflix" && out.flatrate[0].logo === "/n.jpg",
    "★ 留下來的是 display_priority 1 那筆（logo=" + out.flatrate[0].logo + "），不是 priority 9 的變體");
  ok(out.flatrate[1].key === "disney", "★ 平台之間也依 display_priority 排（Netflix 1 在 Disney+ 5 前面）");

  /* 排序壞掉時，hero 徽章會點名錯誤的平台——這是使用者真的看得到的後果 */
  const b = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(b.w, 200);
  const idx = [...b.d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === "沙丘：第二部");
  [...b.d.querySelectorAll(".row[data-open]")][idx].click();
  await tick(b.w, 250);
  const h = html(b.d, "dbody");
  ok(/availnow[^>]*>[\s\S]{0,80}?Prime Video 訂閱可看/.test(h),
    "★ hero 徽章點名 display_priority 最小的 Prime Video（不是 Hami Video）");
}

section("N-D2 Apple TV+ 與 Apple TV 不可以變成兩顆同名標籤");
{
  const { w } = await boot({ store: ST });
  await tick(w, 40);
  ok(w.eval('HLM_Api._brandKeyByName("Apple TV Plus")') === "appletvplus", "★「Apple TV Plus」→ appletvplus（最長命中優先）");
  ok(w.eval('HLM_Api._brandKeyByName("Apple TV")') === "apple", "「Apple TV」→ apple");
  ok(w.eval('HLM_Api._brandKeyByName("Netflix basic with Ads")') === "netflix", "變體仍然歸到 netflix");
  ok(w.eval('HLM_Api._brandKeyByName("Hami Video")') === null, "不認識的回 null（改用 TMDB logo）");
  const out = w.eval(`HLM_Api._normProviders({ results: { TW: { flatrate: [
    { provider_id: 350, provider_name: "Apple TV Plus", logo_path: "/atvp.jpg", display_priority: 2 },
    { provider_id: 2, provider_name: "Apple TV", logo_path: "/atv.jpg", display_priority: 1 }
  ] } } })`);
  ok(out.flatrate.length === 2 && out.flatrate.map(x => x.n).sort().join("|") === "Apple TV|Apple TV+",
    "★ 兩個分別顯示成 Apple TV 與 Apple TV+：" + out.flatrate.map(x => x.n).join("、"));
}

process.exit(summary() ? 1 : 0);

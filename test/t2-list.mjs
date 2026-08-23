import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };
const rows = d => [...d.querySelectorAll(".row[data-open]")];
const titles = d => rows(d).map(r => r.querySelector(".rowtitle").textContent);

section("4. 電影院分頁（狀態 1/5/6）");
{
  const { w, d, calls } = await boot({ store: ST });
  await tick(w, 60);
  ok(txt(d, "listTitle") === "現在電影院上映中 · 6 部", "標題：" + txt(d, "listTitle"));
  ok(titles(d)[0] === "蜘蛛人：穿越新宇宙 終章", "預設依評價排序，8.4 在最前：" + titles(d).join(","));
  ok(titles(d)[titles(d).length - 1] === "我家的事", "沒有評分的排最後");
  const h = html(d, "list");
  ok(/TMDB<\/span><span class="v"[^>]*>8\.4</.test(h), "TMDB 膠囊 = 標籤 + 10 分制一位小數");
  ok(/僅 8 人評，還不準/.test(h), "狀態 5：票數 <50 給琥珀警示");
  ok(/tpill na[\s\S]*?尚無評分/.test(h) && /剛上映，還沒人評/.test(h), "狀態 6：完全沒評分 → 膠囊灰化");
  ok(/8,910|1,180 人評/.test(h), "≥50 票顯示人數");
  ok(/tag cinema/.test(h) && /上映中/.test(h), "電影院分頁每列有「上映中」標籤");
  ok(/列表分數是 <b>TMDB 觀眾評分<\/b>/.test(html(d, "hintline")), "列表頂端有一行說明分數來源");
  ok(!$(d, "sortbtn").classList.contains("hide"), "電影院分頁有排序切換");
  ok(txt(d, "sortbtn") === "依評價 ▾", "預設依評價");
  ok(calls.list.filter(u => u.includes("omdbapi")).length === 0, "★ 列表頁完全沒有呼叫 OMDb");
  ok(calls.list.filter(u => /\/movie\/\d+\/watch\/providers/.test(u)).length === 0, "電影院分頁不去逐片抓平台（省呼叫）");

  $(d, "sortbtn").click(); await tick(w, 40);
  ok(txt(d, "sortbtn") === "依熱門 ▾" && titles(d)[0] === "蜘蛛人：穿越新宇宙 終章", "切依熱門（pop 98 也是蜘蛛人）");
  ok(titles(d)[1] === "玩具總動員 5", "依熱門第二名是 pop 95：" + titles(d).join(","));
  ok(w.localStorage.getItem("hlm_sort") === '"pop"', "排序有持久化");
}

section("5. 串流分頁 + 平台篩選（狀態 2/3/4）");
{
  const { w, d, calls } = await boot({ store: ST });
  await tick(w, 60);
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 80);
  ok(txt(d, "listTitle") === "訂閱就能看 · 3 部", "串流片單：" + txt(d, "listTitle"));
  { const sc = rows(d).map(r => parseFloat((r.querySelector(".tpill .v")||{textContent:"0"}).textContent) || 0);
    ok(sc.every((v, i) => i === 0 || sc[i-1] >= v), "串流固定依評分由高到低：" + sc.join(",")); }
  ok($(d, "sortbtn").classList.contains("hide"), "串流分頁不給排序切換");
  ok(!$(d, "pfWrap").classList.contains("hide"), "串流分頁才有平台篩選列");
  ok(/全部平台/.test(html(d, "pfbar")) && /Netflix/.test(html(d, "pfbar")), "篩選列第一顆是全部平台");
  ok(!/Apple TV|Google TV/.test(html(d, "pfbar")), "Apple TV／Google TV 不進篩選列");
  const disc = calls.list.filter(u => u.includes("/discover/movie"))[0];
  ok(/watch_region=TW/.test(disc) && /with_watch_monetization_types=flatrate/.test(disc), "discover 帶 TW + flatrate：" + (disc || "").slice(40, 160));
  ok(/pv-dot/.test(html(d, "list")), "平台色塊有補上（背景抓 watch/providers）");
  ok(calls.list.filter(u => u.includes("omdbapi")).length === 0, "★ 串流列表也沒呼叫 OMDb");

  // 篩 Netflix
  d.querySelector('[data-pf="netflix"]').click(); await tick(w, 80);
  ok(/pf on/.test(html(d, "pfbar")), "選中的 chip 反白");
  ok(/目前只看：<b>Netflix<\/b>/.test(html(d, "hintline")), "說明行列出目前只看哪些平台");
  ok(titles(d).length === 2, "Netflix 只剩 2 部：" + titles(d).join(","));
  ok(w.localStorage.getItem("hlm_pf") === '["netflix"]', "篩選有持久化");

  // 篩到沒東西
  d.querySelector('[data-pf="netflix"]').click();
  d.querySelector('[data-pf="myvideo"]').click(); await tick(w, 80);
  ok(/你選的平台目前沒有片/.test(html(d, "emptyBox")), "狀態 4：篩選無結果的空狀態");
  d.querySelector('[data-pf="__all"]').click(); await tick(w, 80);
  ok(titles(d).length === 3, "「看全部平台」把篩選清掉");
}

section("6. 分頁狀態持久化");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream", hlm_pf: ["netflix"] } });
  await tick(w, 80);
  ok(txt(d, "listTitle") === "訂閱就能看 · 2 部", "下次打開回到上次的分頁與篩選：" + txt(d, "listTitle"));
}

section("7. 搜尋（狀態 7/8）");
{
  const { w, d, calls } = await boot({ store: ST });
  await tick(w, 60);
  $(d, "q").value = "沙丘";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  ok(/skel/.test(html(d, "list")), "狀態 7：送出後先出 skeleton");
  ok(txt(d, "listTitle") === "搜尋中…", "標題「搜尋中…」");
  await tick(w, 80);
  ok(txt(d, "listTitle") === "搜尋結果 · 1 部", "搜到了：" + txt(d, "listTitle"));
  ok($(d, "tabs").classList.contains("hide"), "搜尋時分頁列隱藏");
  ok($(d, "pfWrap").classList.contains("hide"), "搜尋時平台篩選列隱藏");
  ok($(d, "recentWrap").classList.contains("hide"), "搜尋時最近查詢隱藏");
  ok(JSON.parse(w.localStorage.getItem("hlm_recent"))[0] === "沙丘", "查詢字進最近查詢");
  ok(calls.list.filter(u => u.includes("omdbapi")).length === 0, "★ 搜尋也沒呼叫 OMDb");

  $(d, "q").value = "鐵達尼";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 80);
  ok(/找不到「鐵達尼」/.test(html(d, "emptyBox")), "狀態 8：查無結果");
  ok(/data-kw="沙丘"/.test(html(d, "emptyBox")), "查無結果有 3 個範例關鍵字");

  // 搜尋結果標「電影院上映中」
  $(d, "q").value = "蜘蛛人";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 100);
  ok(/電影院上映中/.test(html(d, "list")), "搜尋結果會標「電影院上映中」");

  // 清除 → 回片單
  $(d, "clr").click(); await tick(w, 60);
  ok(!$(d, "tabs").classList.contains("hide") && /現在電影院上映中/.test(txt(d, "listTitle")), "清除後回到片單");
  ok(!$(d, "recentWrap").classList.contains("hide") && /沙丘/.test(html(d, "recent")), "最近查詢 chips 回來");

  // 最近查詢單筆刪除
  const before = JSON.parse(w.localStorage.getItem("hlm_recent")).length;
  d.querySelector("[data-del]").click(); await tick(w, 30);
  ok(JSON.parse(w.localStorage.getItem("hlm_recent")).length === before - 1, "最近查詢可單筆刪除");
}

process.exit(summary() ? 1 : 0);

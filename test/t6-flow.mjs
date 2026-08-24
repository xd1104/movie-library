import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";

section("25. 老闆第一次開 App 的完整路徑（從零到查到一部片）");
{
  const { w, d, calls } = await boot();                       // 全新、沒有任何金鑰
  await tick(w, 120);
  /* v1.3.0：沒有「第一次要設定金鑰」那一頁；拿不到金鑰就在首頁給逃生門 */
  ok(/現在還不能查片/.test(html(d, "emptyBox")), "① 開起來就在首頁，並說明現在還不能查片");
  ok(calls.list.length === 0, "還沒有 key 就不會亂打 API（0 次呼叫）");

  $(d, "ktmdb").value = KEYS.GOOD_TMDB;
  $(d, "komdb").value = KEYS.GOOD_OMDB;
  $(d, "saveTest").click(); await tick(w, 80);
  ok(/tr ok[\s\S]*TMDB 正常/.test(html(d, "testout")), "② 測試連線兩邊都 ✓");

  d.querySelector('[data-act="home"]').click(); await tick(w, 100);
  ok(d.getElementById("view-home").style.display === "block", "③ 按「開始查片」回到首頁");
  ok(d.querySelectorAll(".row[data-open]").length === 6, "④ 電影院片單直接出來（" + d.querySelectorAll(".row").length + " 部）");

  d.querySelector(".row[data-open]").click(); await tick(w, 150);
  const h = html(d, "dbody");
  ok(/綜合評價/.test(h) && /IMDb/.test(h), "⑤ 點進去看得到綜合評價與四個分數");
  ok(/台灣哪裡看得到/.test(h), "⑥ 也看得到台灣哪裡看");
  $(d, "back").click(); await tick(w, 60);
  ok(d.getElementById("view-home").style.display === "block", "⑦ 返回回得去");
  ok(w.localStorage.getItem("hlm_key_tmdb") !== null, "⑧ 金鑰記住了，下次不用再設定");

  const b2 = await boot({ rawStore: Object.fromEntries([...Array(w.localStorage.length).keys()].map(i => [w.localStorage.key(i), w.localStorage.getItem(w.localStorage.key(i))])) });
  await tick(b2.w, 80);
  ok(!b2.d.getElementById("view-setup").classList.contains("on"), "⑨ 第二次打開不再問金鑰");
  ok(b2.d.querySelectorAll(".row[data-open]").length === 6, "⑩ 直接看到片單");
  ok(b2.calls.list.length === 0, "⑪ 而且 6 小時內全走快取，一次 API 都沒打");
}

section("26. 詳細頁出錯時的重試會重抓那部片（不是重抓片單）");
{
  const { w, d } = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB } });
  await tick(w, 60);
  // 讓後續請求全掛
  w.eval('window.fetch = function(){ return Promise.reject(new TypeError("Failed to fetch")); }');
  d.querySelector(".row[data-open]").click(); await tick(w, 80);
  let h = html(d, "dbody");
  ok(/連不上網路/.test(h), "詳細頁抓不到 → 給「連不上網路」");
  ok(/backbar/.test(h), "還是有返回鈕，不會被困住");
  ok(d.getElementById("view-detail").classList.contains("on"), "還在詳細頁");
  d.querySelector('[data-act="retry"]').click(); await tick(w, 60);
  ok(d.getElementById("view-detail").classList.contains("on"), "★ 按重試仍留在詳細頁（修掉了會跳回片單的 bug）");
}

section("27. 舊資料相容：localStorage 裡有壞掉的值不可以炸掉");
{
  const { w, d } = await boot({
    rawStore: {
      hlm_key_tmdb: '"' + KEYS.GOOD_TMDB + '"',
      hlm_tab: "not-json{{",
      hlm_pf: '"應該是陣列卻是字串"',
      hlm_recent: "123",
      "hlm_c:cine": "{壞掉的 json"
    }
  });
  await tick(w, 100);
  ok(d.querySelectorAll(".row[data-open]").length === 6, "壞掉的偏好值 → 退回預設，App 照常跑");
  ok(txt(d, "listTitle").includes("電影院"), "分頁退回預設的電影院：" + txt(d, "listTitle"));
}

process.exit(summary() ? 1 : 0);

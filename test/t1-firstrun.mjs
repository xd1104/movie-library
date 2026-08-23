import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";

section("1. 第一次使用：沒有金鑰");
{
  const { w, d } = await boot();
  ok(d.getElementById("view-setup").classList.contains("on"), "沒金鑰 → 開機直接進設定頁（不用等他搜尋才報錯）");
  const h = html(d, "sbody");
  ok(/先設定一次/.test(h), "標題是「先設定一次，之後就不用了」");
  ok(/API Key \(v3 auth\)/.test(h), "有講清楚要 TMDB 的 API Key v3 auth");
  ok(/eyJ/.test(h), "有提醒別拿 Read Access Token");
  ok(/FREE.*1,000 daily limit/.test(h), "有講 OMDb 要選 FREE 1000/day");
  ok(/啟用連結，一定要點下去/.test(h), "有明講 OMDb 啟用信一定要點");
  ok(/themoviedb\.org\/settings\/api/.test(h) && /omdbapi\.com\/apikey/.test(h), "兩個申請網址都給了");
  ok(!/訂票|去 Netflix|立即觀看/.test(h), "設定頁沒有任何導購字眼");
  ok(w.location.hash === "#/setup", "hash 換成 #/setup");
  const inputs = [...d.querySelectorAll("input")];
  ok(inputs.length >= 3, "有輸入框");
}

section("2. 測試連線：三條路徑（沒 key／key 錯／key 對）");
{
  const { w, d } = await boot();
  // 沒填
  $(d, "saveTest").click(); await tick(w, 40);
  let o = html(d, "testout");
  ok(/還沒填 TMDB 金鑰/.test(o), "沒填 TMDB → 明確說沒填");
  ok(/沒填 OMDb 金鑰也能用/.test(o), "沒填 OMDb → 說明只是少三個分數（不算失敗）");
  ok(!/開始查片/.test(o), "TMDB 沒過就不給「開始查片」");

  // 填錯
  $(d, "ktmdb").value = "WRONG"; $(d, "komdb").value = "WRONGOMDB";
  $(d, "saveTest").click(); await tick(w, 60);
  o = html(d, "testout");
  ok(/tr ng/.test(o) && /TMDB 金鑰無效/.test(o), "TMDB key 錯 → ✗ 金鑰無效");
  ok(/OMDb 金鑰無效，或啟用信還沒點/.test(o), "OMDb key 錯 → 明確提示可能是沒點啟用信");
  ok((o.match(/tr ng/g) || []).length === 2, "兩邊各自給結果，不是混在一起");

  // 一對一錯（TMDB 對、OMDb 錯）→ 仍可用
  $(d, "ktmdb").value = KEYS.GOOD_TMDB; $(d, "komdb").value = "WRONGOMDB";
  $(d, "saveTest").click(); await tick(w, 60);
  o = html(d, "testout");
  ok(/tr ok/.test(o) && /TMDB 正常/.test(o), "TMDB 對 → ✓ 正常");
  ok(/tr ng/.test(o), "同時 OMDb 仍標 ✗");
  ok(/開始查片/.test(o), "TMDB 過了就給「開始查片」（缺 OMDb 不擋）");

  // 兩個都對
  $(d, "komdb").value = KEYS.GOOD_OMDB;
  $(d, "saveTest").click(); await tick(w, 60);
  o = html(d, "testout");
  ok((o.match(/tr ok/g) || []).length === 2, "兩把 key 都對 → 兩個 ✓");
  ok(w.localStorage.getItem("hlm_key_tmdb") === JSON.stringify(KEYS.GOOD_TMDB), "金鑰存進 localStorage");
}

section("3. 只有 TMDB 沒有 OMDb 也要能用");
{
  const { w, d } = await boot({ store: { hlm_key_tmdb: KEYS.GOOD_TMDB } });
  await tick(w, 60);
  ok(!d.getElementById("view-setup").classList.contains("on"), "有 TMDB key → 不進設定頁");
  ok(/現在電影院上映中/.test(txt(d, "listTitle")), "片單正常出來：" + txt(d, "listTitle"));
  d.querySelector("[data-open]").click(); await tick(w, 60);
  const h = html(d, "dbody");
  ok(/查無收錄/.test(h), "IMDb／爛番茄／Metacritic 顯示「查無收錄」而不是卡住");
  ok(/還沒設定 OMDb 金鑰/.test(h), "綜合環說明缺 OMDb 的原因");
  ok(!/errbox/.test(h), "沒有 OMDb 不會跳錯誤卡");
}

process.exit(summary() ? 1 : 0);

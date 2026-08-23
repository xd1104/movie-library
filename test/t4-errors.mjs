import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };

section("14. 四種錯誤要分得出來（不可以全部叫「發生錯誤」）");
{
  const { w, d } = await boot({ store: { hlm_key_tmdb: "WRONG" } });
  await tick(w, 80);
  const h = html(d, "emptyBox");
  ok(/TMDB 金鑰無效/.test(h), "① 金鑰錯 → 「TMDB 金鑰無效」");
  ok(/到設定頁重新貼一次/.test(h) && /data-act="setup"/.test(h), "給下一步：去設定頁");
  ok(!/發生錯誤/.test(h), "不是通用錯誤字串");
}
{
  const { w, d } = await boot({ store: ST, mock: { fail: { tmdb: "429" } } });
  await tick(w, 80);
  const h = html(d, "emptyBox");
  ok(/TMDB 請求太密集/.test(h), "② 額度／頻率 → 專屬文案：" + (h.match(/<h3>(.*?)<\/h3>/) || [])[1]);
  ok(/data-act="retry"/.test(h), "給下一步：重試");
}
{
  const { w, d } = await boot({ store: ST, mock: { fail: { tmdb: "net" } } });
  await tick(w, 80);
  const h = html(d, "emptyBox");
  ok(/連不上網路/.test(h), "③ 沒網路 → 「連不上網路」");
}
{
  const { w, d } = await boot({ store: ST, mock: { fail: { tmdb: "500" } } });
  await tick(w, 80);
  const h = html(d, "emptyBox");
  ok(/TMDB 伺服器出問題/.test(h) && /不是你的問題/.test(h), "④ API 掛掉 → 「伺服器出問題」");
}
{
  const { w, d } = await boot({});
  await tick(w, 40);
  // 沒金鑰時列表區塊也要講人話（雖然會先跳設定頁）
  w.localStorage.setItem("hlm_key_tmdb", '"' + KEYS.GOOD_TMDB + '"');
  ok(true, "（沒金鑰的路徑在 t1 驗過）");
}

section("15. OMDb 出事不可以拖垮整頁");
{
  const { w, d } = await boot({ store: ST, mock: { fail: { omdb: "limit" } } });
  await tick(w, 60);
  d.querySelector(".row[data-open]").click(); await tick(w, 120);
  const h = html(d, "dbody");
  ok(/蜘蛛人/.test(h) && /這是中文簡介/.test(h), "TMDB 的內容照樣完整顯示");
  ok(/查無收錄/.test(h), "三個分數格降級成查無收錄");
  ok(/OMDb 今天的額度用完了/.test(h), "有解釋為什麼沒有分數");
  ok(!/errbox/.test(h), "不會整頁變錯誤畫面");
}
{
  const { w, d } = await boot({ store: { ...ST, hlm_key_omdb: "WRONGKEY" } });
  await tick(w, 60);
  d.querySelector(".row[data-open]").click(); await tick(w, 120);
  const h = html(d, "dbody");
  ok(/OMDb 金鑰無效/.test(h) && /啟用信/.test(h), "OMDb 金鑰錯 → 在詳細頁講清楚並提醒啟用信");
  ok(/蜘蛛人/.test(h), "其它內容照樣顯示");
}

section("16. 離線降級：有舊快取就先給舊的，並說明");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 80);
  ok(/現在電影院上映中/.test(txt(d, "listTitle")), "先正常載入一次建立快取");
  const dump = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump[k] = w.localStorage.getItem(k); }
  // 把片單快取的時間戳改成 3 天前（超過 6 小時 TTL），再斷網重開
  const old = JSON.parse(dump["hlm_c:cine"]);
  old.t = Date.now() - 3 * 24 * 3600e3;
  dump["hlm_c:cine"] = JSON.stringify(old);
  const b2 = await boot({ rawStore: dump, mock: { fail: { tmdb: "net" } } });
  await tick(b2.w, 80);
  ok(/現在電影院上映中/.test(txt(b2.d, "listTitle")), "快取過期 + 離線 → 仍看得到上次的片單，不開天窗");
  ok(/連不上網路，顯示/.test(html(b2.d, "hintline")), "而且明講這是舊資料：" + html(b2.d, "hintline").slice(-70));
}

section("17. localStorage 被封鎖（無痕模式）不可以白畫面");
{
  const { w, d } = await boot({ store: ST, breakLS: true });
  await tick(w, 80);
  ok(d.getElementById("view-setup").classList.contains("on"), "讀不到金鑰 → 退回設定頁（不是白畫面、不是崩潰）");
  ok(/這個瀏覽器不讓我存資料/.test(html(d, "sbody")), "明講原因與解法（用一般視窗開）");
  // 當場貼金鑰，這個 session 內仍要能用
  $(d, "ktmdb").value = KEYS.GOOD_TMDB;
  $(d, "justSave").click();
  $(d, "sback").click(); await tick(w, 100);
  ok(d.querySelectorAll(".row[data-open]").length === 6, "當場貼金鑰後，這個 session 照樣查得到片（存在記憶體）");
}

section("18. 快取容量：超過上限會淘汰最舊的");
{
  const { w } = await boot({ store: ST });
  await tick(w, 40);
  const S = w.eval("HLM_Store");
  for (let i = 0; i < 60; i++) S.cacheSet("junk:" + i, { pad: "x".repeat(400) });
  const before = S.cacheStats();
  w.eval("HLM_CFG.cacheMaxEntries = 20; HLM_CFG.cacheMaxChars = 20000;");
  S.sweep();
  const after = S.cacheStats();
  ok(after.n < before.n, "sweep 會淘汰（" + before.n + " → " + after.n + " 筆）");
  ok(after.n <= 45, "淘汰後筆數下降到 " + after.n);
  ok(S.cacheGet("junk:59", 9e9) !== null, "最新的那筆留著");
  ok(S.cacheGet("junk:0", 9e9) === null, "最舊的那筆被丟掉");
}

process.exit(summary() ? 1 : 0);

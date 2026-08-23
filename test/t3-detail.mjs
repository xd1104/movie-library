import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS, D_FUTURE } from "./mock-api.mjs";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };
const openRow = async (w, d, idx = 0, wait = 80) => {
  [...d.querySelectorAll(".row[data-open]")][idx].click();
  await tick(w, wait);
};

section("8. 詳細頁漸進顯示（狀態 9 → 10，不可以等齊才畫）");
{
  const { w, d } = await boot({ store: ST, mock: { delay: { omdb: 120 } } });
  await tick(w, 60);
  const idx = [...d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === "蜘蛛人：穿越新宇宙 終章");
  [...d.querySelectorAll(".row[data-open]")][idx].click();
  await tick(w, 30);                      // TMDB 到、OMDb 還在路上
  let h = html(d, "dbody");
  ok(/蜘蛛人：穿越新宇宙 終章/.test(h), "第一段：片名已經畫出來");
  ok(/這是中文簡介/.test(h), "第一段：簡介已經畫出來");
  ok(/TMDB<\/span>[\s\S]*?8\.4/.test(h), "第一段：TMDB 分數已經有了");
  ok((h.match(/class="sc">/g) || []).length >= 1 && /skel/.test(h), "第一段：IMDb／爛番茄／Metacritic 是骨架佔位");
  ok(!/綜合評價/.test(h), "第一段：綜合分數環還沒算（也是骨架）");
  await tick(w, 200);
  h = html(d, "dbody");
  ok(/綜合評價/.test(h) && /ring/.test(h), "第二段：OMDb 到了，綜合環出現");
  ok(/5\.1/.test(h) && /94/.test(h), "第二段：IMDb 5.1 與爛番茄 94% 補上");
  ok(/查無收錄/.test(h), "狀態 11：Metacritic 缺值 → 虛線 + 查無收錄");
  ok(/divergent/.test(h) && /影評人給了高分/.test(h), "狀態 13：影評與觀眾分歧提示");
  const ring = (h.match(/class="num"[^>]*>(\d+)</) || [])[1];
  ok(ring === "76", "綜合分算術平均正確：(51+94+84)/3 → " + ring);
}

section("9. 詳細頁其它狀態（12 / 14 / 平台分組）");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 60);
  // 角頭（id 4）：OMDb Movie not found、票數 8
  let idx = [...d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === "角頭－鬥陣欸");
  await openRow(w, d, idx, 120);
  let h = html(d, "dbody");
  ok(/資料.*不足/.test(h) && /還無法判斷/.test(h), "狀態 12：有值分數 <2 → 資料不足");
  ok(/收錄不足/.test(h), "說明為什麼算不出來");
  ok(!/errbox/.test(h), "★ OMDb 查不到（台片常態）不跳錯誤");
  ok(/TMDB 只有 8 人評分，這個分數參考價值有限/.test(h), "票數 <50 的補充說明");
  ok(/僅租借／購買|租借/.test(h), "平台區塊有出來");

  // 未上映片（搜尋才找得到）：狀態 14 的「未上映」版本
  $(d, "back").click(); await tick(w, 60);
  $(d, "q").value = "復仇者";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 100);
  ok(/tag soon/.test(html(d, "list")) && /尚未上映/.test(html(d, "list")), "搜尋結果：未上映片標「尚未上映」");
  await openRow(w, d, 0, 150);
  h = html(d, "dbody");
  ok(/這部片還沒上映/.test(h), "狀態 14a：未上映 → 專屬文案");
  { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(D_FUTURE);
    const want = m[1] + " 年 " + (+m[2]) + " 月 " + (+m[3]) + " 日上映";
    ok(h.indexOf(want) >= 0, "hero 顯示上映日（定案 demo 的寫法）：" + want); }
  ok(/本片尚未上映，各站都還沒有評分/.test(h), "綜合環說明未上映");

  // 只有租借／購買：狀態 15
  $(d, "back").click(); await tick(w, 60);
  $(d, "q").value = "小丑";
  $(d, "sform").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  await tick(w, 150);
  ok(/僅租借／購買/.test(html(d, "list")), "狀態 15：列表標「僅租借／購買」");
  await openRow(w, d, 0, 150);
  h = html(d, "dbody");
  ok(/租借/.test(h) && /購買/.test(h) && !/訂閱可看/.test(h), "詳細頁只有租借／購買分組");
  ok(/availnow none[^>]*>僅租借／購買/.test(h), "hero 徽章「僅租借／購買」");
  ok(/價格各平台不同，TMDB 不提供價格/.test(h), "誠實說明沒有價格資料");

}

section("10. 平台是純標籤、沒有任何外連");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 100);
  await openRow(w, d, 0, 150);
  const h = html(d, "dbody");
  ok(/class="pv"/.test(h), "有平台標籤");
  ok(!/<a /.test(h), "★ 詳細頁沒有任何 <a> 外連");
  ok(!/<button[^>]*class="pv/.test(h) && !/data-pv/.test(h), "★ 平台不是按鈕、不可點");
  ok(!/訂票|查場次|前往|立即觀看|去 Netflix/.test(h), "★ 沒有任何導購字眼");
  ok(/訂閱可看/.test(h) && /租借/.test(h) && /購買/.test(h), "分組：訂閱 → 租借 → 購買");
  ok(h.indexOf("訂閱可看") < h.indexOf("租借") && h.indexOf("租借") < h.indexOf("購買"), "分組順序正確");
  ok(/backbar/.test(h) && /回串流片單/.test(h), "底部只有一顆返回鈕，文案隨來源變化");
  ok((h.match(/class="backbar"/g) || []).length === 1, "底部列只有一顆鈕");
  ok(/更新於 20/.test(h), "底部顯示更新時間");
}

section("11. 不在字典裡的平台（Hami Video）用 TMDB logo，不亂配色");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 100);
  const idx = [...d.querySelectorAll(".rowtitle")].findIndex(e => e.textContent === "沙丘：第二部");
  await openRow(w, d, idx, 150);
  const h = html(d, "dbody");
  ok(/Hami Video/.test(h), "陌生平台照樣列出來");
  ok(/image\.tmdb\.org\/t\/p\/w45\/hami\.jpg/.test(h), "用 TMDB 官方 logo");
}

section("12. 返回：回到原本的捲動位置、hash 正確");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 60);
  await openRow(w, d, 0, 100);
  ok(/^#\/m\/\d+$/.test(w.location.hash), "詳細頁有自己的 hash（iOS 側滑返回可用）：" + w.location.hash);
  ok(d.getElementById("view-detail").classList.contains("on"), "顯示詳細頁");
  $(d, "back").click(); await tick(w, 60);
  ok(!d.getElementById("view-detail").classList.contains("on"), "返回後回到首頁");
  ok(d.getElementById("view-home").style.display === "block", "首頁重新顯示");
}

section("13. 快取：第二次進同一部片不再打 API，且直接畫完整狀態");
{
  const { w, d, calls } = await boot({ store: ST, mock: { delay: { omdb: 60 } } });
  await tick(w, 60);
  await openRow(w, d, 0, 200);
  const n1 = calls.list.length;
  $(d, "back").click(); await tick(w, 60);
  await openRow(w, d, 0, 5);              // 只等 5ms
  const h = html(d, "dbody");
  ok(calls.list.length === n1, "第二次進同一部片：0 次新的 API 呼叫（" + n1 + " → " + calls.list.length + "）");
  ok(/綜合評價/.test(h) && !/skel/.test(h), "★ 快取命中直接畫完整狀態，不假裝載入");

  // 片單快取
  const n2 = calls.list.length;
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 80);
  d.querySelector('[data-tab="cinema"]').click(); await tick(w, 40);
  const cineCalls = calls.list.slice(n2).filter(u => u.includes("now_playing")).length;
  ok(cineCalls === 0, "回到電影院分頁不重打 now_playing（6 小時快取）");

  // 重新抓一次
  const n3 = calls.list.length;
  await openRow(w, d, 0, 60);
  $(d, "refresh").click(); await tick(w, 150);
  ok(calls.list.length > n3, "「重新抓一次這部片」會真的重打（" + (calls.list.length - n3) + " 次）");
}

process.exit(summary() ? 1 : 0);

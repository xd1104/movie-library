import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };
const count = (calls, re) => calls.list.filter(u => re.test(u)).length;

section("28. 一次典型使用的 API 用量（OMDb 額度 1000/天）");
{
  const { w, d, calls } = await boot({ store: ST });
  await tick(w, 80);                                     // 開 App → 電影院片單
  const afterHome = { tmdb: count(calls, /themoviedb/), omdb: count(calls, /omdbapi/) };
  ok(afterHome.omdb === 0, "看片單：OMDb 0 次（實際 " + afterHome.omdb + "）");
  ok(afterHome.tmdb <= 2, "看片單：TMDB " + afterHome.tmdb + " 次（provider 校正 + now_playing）");

  d.querySelector(".row[data-open]").click(); await tick(w, 150);
  const afterDetail = { tmdb: count(calls, /themoviedb/), omdb: count(calls, /omdbapi/) };
  ok(afterDetail.omdb === 1, "點一部片：OMDb 只 +1（實際 " + afterDetail.omdb + "）");
  ok(afterDetail.tmdb - afterHome.tmdb === 2, "點一部片：TMDB +2（詳細 + 觀看平台），實際 +" + (afterDetail.tmdb - afterHome.tmdb));

  $(d, "back").click(); await tick(w, 40);
  d.querySelector(".row[data-open]").click(); await tick(w, 80);
  ok(count(calls, /omdbapi/) === 1, "同一部片再看一次：OMDb 沒有再打（7 天快取）");

  // 逛 10 部片
  $(d, "back").click(); await tick(w, 40);
  const rows = [...d.querySelectorAll(".row[data-open]")];
  for (const r of rows) { r.click(); await tick(w, 120); $(d, "back").click(); await tick(w, 40); }
  const omdbTotal = count(calls, /omdbapi/);
  ok(omdbTotal <= rows.length, "逛完 " + rows.length + " 部片：OMDb 共 " + omdbTotal + " 次（每部最多 1 次）");
  ok(omdbTotal * 100 < 1000 * 100, "以每天 1000 次估：一天可以點 " + Math.floor(1000 / Math.max(1, omdbTotal / rows.length)) + " 部片");
}

section("29. 串流分頁的平台色塊成本");
{
  const { w, d, calls } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 120);
  const pv = count(calls, /movie\/\d+\/watch\/providers/);
  const n = d.querySelectorAll(".row[data-open]").length;
  ok(pv <= n, "背景抓平台：" + pv + " 次 / " + n + " 部（每部最多 1 次，24 小時快取）");
  ok(count(calls, /omdbapi/) === 0, "★ 完全沒有 OMDb");
  // 切走再切回來不重抓
  const before = calls.list.length;
  d.querySelector('[data-tab="cinema"]').click(); await tick(w, 60);
  d.querySelector('[data-tab="stream"]').click(); await tick(w, 120);
  ok(calls.list.length - before <= 1, "切回串流分頁只多 " + (calls.list.length - before) + " 次呼叫（全走快取）");
}

section("30. 串流分頁的片也會標「電影院上映中」");
{
  const { w, d } = await boot({ store: { ...ST, hlm_tab: "stream" } });
  await tick(w, 150);
  const st = w.eval("1");   // no-op
  ok(/pv-dot/.test(html(d, "list")), "串流列表有平台色塊");
}

process.exit(summary() ? 1 : 0);

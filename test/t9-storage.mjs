/* 快取層的迴歸測試：淘汰順序、寫不下的重試、過期降級的條件 */
import { boot, tick, $, txt, html, ok, section, summary } from "./harness.mjs";
import { KEYS } from "./mock-api.mjs";
const ST = { hlm_key_tmdb: KEYS.GOOD_TMDB, hlm_key_omdb: KEYS.GOOD_OMDB };

section("M02 / M04 localStorage 寫不下的時候：要淘汰最舊的、而且要重試");
{
  const { w } = await boot({ quotaBytes: 6000 });     // 沒金鑰 → 開機不打 API，儲存空間乾淨
  await tick(w, 40);
  const S = w.eval("HLM_Store");
  const base = Date.now() - 20 * 60000;
  for (let i = 0; i < 20; i++) {                       // j0 最舊 → j19 最新
    w.localStorage.setItem("hlm_c:j" + i, JSON.stringify({ t: base + i * 60000, v: "x".repeat(200) }));
  }
  ok(S.cacheStats().n === 20, "先塞 20 筆：" + S.cacheStats().n);

  const wrote = S.cacheSet("big", "y".repeat(2000));   // 一定塞不下 → 觸發淘汰 + 重試
  ok(wrote === true, "★ 寫不下時會淘汰一半再重試，最後有寫成功（M04）");
  ok(S.cacheGet("big", 9e9) !== null, "★ 新資料真的存進去了");

  const gone = [], kept = [];
  for (let i = 0; i < 20; i++) (S.cacheGet("j" + i, 9e9) === null ? gone : kept).push(i);
  ok(gone.length > 0 && gone.every(i => i < 10), "★ 被砍掉的都是最舊的那一半（M02）：砍了 j" + gone.join(",j"));
  ok(kept.includes(19) && kept.includes(18), "★ 最新的那幾筆留著：留了 " + kept.length + " 筆");
  ok(!gone.includes(19), "★ 絕對不可以砍掉最新的");
}

section("M28 過期快取只在「連不上」的時候頂替；金鑰錯一定要讓他知道");
{
  const a = await boot({ store: ST });
  await tick(a.w, 100);
  ok(/現在電影院上映中/.test(txt(a.d, "listTitle")), "先建立一份片單快取");
  const dump = {};
  for (let i = 0; i < a.w.localStorage.length; i++) {
    const k = a.w.localStorage.key(i);
    dump[k] = a.w.localStorage.getItem(k);
  }
  const cine = JSON.parse(dump["hlm_c:cine"]);
  cine.t = Date.now() - 3 * 24 * 3600e3;               // 讓它過期
  dump["hlm_c:cine"] = JSON.stringify(cine);

  // ① 金鑰錯 → 不可以拿舊快取頂著
  const b = await boot({ rawStore: { ...dump, hlm_key_tmdb: '"WRONGKEY"' } });
  await tick(b.w, 120);
  ok(/TMDB 金鑰無效/.test(html(b.d, "emptyBox")), "★ 金鑰錯：顯示「金鑰無效」，不可以用舊快取蓋過去");
  ok(!/現在電影院上映中/.test(txt(b.d, "listTitle")), "★ 而且不可以還畫著舊片單裝沒事：" + JSON.stringify(txt(b.d, "listTitle")));

  // ② 斷網 → 才可以拿舊快取頂著（對照組）
  const c = await boot({ rawStore: dump, mock: { fail: { tmdb: "net" } } });
  await tick(c.w, 120);
  ok(/現在電影院上映中/.test(txt(c.d, "listTitle")), "對照組：斷網才用舊快取");
  ok(/連不上網路，顯示/.test(html(c.d, "hintline")), "而且有講清楚是舊的");
}

section("補強：電影院兩種排序的完整順序（只驗頭尾的話，排序壞掉殺不掉）");
{
  const { w, d } = await boot({ store: ST });
  await tick(w, 100);
  const titles = () => [...d.querySelectorAll(".rowtitle")].map(e => e.textContent);
  ok(titles().join(",") === "蜘蛛人：穿越新宇宙 終章,玩具總動員 5,侏羅紀世界：重生,罪人,角頭－鬥陣欸,我家的事",
    "★ 預設依熱門：完全依 popularity → " + titles().join(","));
  $(d, "sortbtn").click(); await tick(w, 60);
  ok(titles().join(",") === "蜘蛛人：穿越新宇宙 終章,罪人,玩具總動員 5,侏羅紀世界：重生,角頭－鬥陣欸,我家的事",
    "★ 切成依評價：完全依 TMDB 分數由高到低 → " + titles().join(","));
}

process.exit(summary() ? 1 : 0);

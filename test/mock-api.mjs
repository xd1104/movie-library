/* 假的 TMDB / OMDb（只驗行為，不驗真實回傳內容） */
export const CALLS = { list: [], reset(){ this.list=[]; } };

const GOOD_TMDB = "TMDBKEY_GOOD", GOOD_OMDB = "OMDBGOOD";

/* 跟「今天」相對的日期，測試才不會過幾天就自己壞掉 */
export function dayOffset(n) {
  const d = new Date(Date.now() + n * 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export const D_RECENT = dayOffset(-2);     // 本週剛上映
export const D_OLD = dayOffset(-90);       // 上映很久了
export const D_EDGE = dayOffset(-8);       // 剛好超過「本週」一天
export const D_FUTURE = dayOffset(500);    // 還沒上映

function mv(id, title, orig, date, avg, votes, pop, poster) {
  return { id, title, original_title: orig, release_date: date, vote_average: avg, vote_count: votes, popularity: pop, poster_path: poster };
}

export const NOW_PLAYING = [
  mv(1, "蜘蛛人：穿越新宇宙 終章", "Spider-Man: Beyond", D_OLD, 8.4, 1180, 98, "/a.jpg"),
  mv(2, "玩具總動員 5", "Toy Story 5", "2026-07-01", 7.6, 892, 95, "/b.jpg"),
  mv(3, "侏羅紀世界：重生", "Jurassic World: Rebirth", "2026-05-20", 6.4, 2320, 88, null),
  mv(4, "角頭－鬥陣欸", "Gatao: Brotherhood", "2026-08-01", 6.1, 8, 44, "/d.jpg"),
  mv(5, "我家的事", "Family Matters", D_RECENT, 0, 0, 31, "/e.jpg"),
  mv(6, "罪人", "Sinners", D_EDGE, 7.9, 3140, 81, "/f.jpg")
];
export const DISCOVER = [
  mv(11, "捍衛戰士：獨行俠", "Top Gun: Maverick", "2022-05-24", 8.2, 8910, 77, "/g.jpg"),
  mv(12, "沙丘：第二部", "Dune: Part Two", "2024-02-27", 8.24, 7420, 84, "/h.jpg"),
  mv(13, "咒", "Incantation", "2022-03-18", 6.6, 930, 49, "/i.jpg")
];
export const DISCOVER_NETFLIX = [DISCOVER[0], DISCOVER[2]];
/* 只靠搜尋找得到：未上映、只有租借／購買 */
export const EXTRA = [
  mv(21, "復仇者聯盟：末日之戰", "Avengers: Doomsday", D_FUTURE, 0, 0, 99, "/x.jpg"),
  mv(22, "小丑：雙重瘋狂", "Joker: Folie a Deux", "2024-10-02", 5.7, 5210, 52, "/j.jpg"),
  /* 迴歸測試專用 */
  mv(23, "爛片示範", "Very Bad Movie", "2024-01-05", 3.4, 900, 20, "/bad.jpg"),   // 低分：色階/用詞
  mv(24, "零票示範", "Zero Votes", "2024-02-05", 7.5, 0, 10, "/z.jpg"),           // 有均分但 0 票
  mv(25, "萬人示範", "Many Votes", "2017-12-15", 6.8, 15200, 58, "/m.jpg")        // 萬人評換算
];

/* ---- 假的 PTT 資料（同源 ./data/ptt-movie.json）----
   key 對應上面假片單的 TMDB id。刻意涵蓋規格 §9.6 的五種狀態。 */
function pp(tag, title, push, date) {
  return { tag, title, url: "https://www.ptt.cc/bbs/movie/M.17871840" + String(push).padStart(2, "0") + ".A.ABC.html", date, push };
}
export const PTT_MOVIES = {
  /* 一面倒好雷：前 4 則沒有負雷 → 會觸發「保底異見」把第 6 則的負雷拉上來 */
  "1": { good: 21, ok: 2, bad: 1, posts: [
    pp("好雷", "[好雷] 蜘蛛人 動畫的極限", 128, "8/22"),
    pp("好雷", "[好雷] 邁爾斯的成長寫得超完整", 86, "8/21"),
    pp("好雷", "[好雷] 音樂跟分鏡值回票價", 74, "8/21"),
    pp("普雷", "[普雷] 好看 但資訊量太大", 41, "8/20"),
    pp("好雷", "[好雷] 二刷才看懂很多細節", 33, "8/20"),
    pp("負雷", "[負雷] 節奏太趕 不喜歡這種剪法", 23, "8/19"),
    pp("好雷", "[好雷] 配樂神", 12, "8/18"),
    pp("好雷", "[好雷] 大銀幕必看", 5, "8/18")
  ]},
  /* 好雷佔多數 + 有 8 則可以展開 */
  "12": { good: 12, ok: 3, bad: 1, posts: [
    pp("好雷", "[好雷] 沙丘2 視聽饗宴 IMAX 值回票價", 145, "8/20"),
    pp("好雷", "[好雷] 沙丘2 節奏比一集好太多", 98, "8/20"),
    pp("普雷", "[普雷] 沙丘2 有點長", 62, "8/19"),
    pp("負雷", "[負雷] 沙丘2 睡著兩次", 44, "8/19"),
    pp("好雷", "[好雷] 沙丘2 音效無敵", 31, "8/18"),
    pp("好雷", "[好雷] 沙丘2 二刷心得", 20, "8/18"),
    pp("好雷", "[好雷] 沙丘2 沙蟲那段", 11, "8/17"),
    pp("好雷", "[好雷] 沙丘2 值得", 6, "8/17")
  ]},
  /* 樣本太少（<=3）：不畫比例條、不給結論詞 */
  "4": { good: 2, ok: 1, bad: 0, posts: [
    pp("好雷", "[好雷] 角頭 台片有進步", 18, "8/15"),
    pp("好雷", "[好雷] 角頭 動作場面不錯", 9, "8/14"),
    pp("普雷", "[普雷] 角頭 劇情老套", 3, "8/13")
  ]},
  /* 負雷居多 */
  "22": { good: 1, ok: 1, bad: 5, posts: [
    pp("負雷", "[負雷] 小丑2 這是什麼", 210, "8/12"),
    pp("負雷", "[負雷] 小丑2 浪費兩小時", 150, "8/12"),
    pp("好雷", "[好雷] 小丑2 我覺得還行", 40, "8/11")
  ]},
  /* 評價兩極：會多出 .divergent 提示框 */
  "3": { good: 7, ok: 3, bad: 6, posts: [
    pp("好雷", "[好雷] 侏羅紀 爽片就是要這樣", 88, "8/10"),
    pp("負雷", "[負雷] 侏羅紀 劇本崩壞", 77, "8/10"),
    pp("好雷", "[好雷] 侏羅紀 恐龍很帥", 55, "8/09"),
    pp("負雷", "[負雷] 侏羅紀 看不下去", 33, "8/09")
  ]}
};
export function pttPayload(over = {}) {
  return {
    updated: new Date(Date.now() - 3600e3).toISOString().replace(/\.\d+Z$/, "Z"),
    source: "https://www.ptt.cc/bbs/movie/index.html",
    scanned: { pages: 40, posts: 797, tagged: 158, matched: 104, ambiguous: 0, unmatched: 54 },
    movies: PTT_MOVIES,
    ...over
  };
}

export function makeFetch(opts = {}) {
  const keys = { tmdb: GOOD_TMDB, omdb: GOOD_OMDB, ...(opts.keys || {}) };
  const fail = opts.fail || {};       // {tmdb:'401'|'429'|'500'|'net', omdb:...}

  return function fetch(url) {
    CALLS.list.push(String(url));

    /* 同源的 PTT 資料檔（相對路徑，不能丟給 new URL 直接解析）
       opts.ptt: "net"（連不到）／"404"／"bad"（不是 JSON）／預設成功 */
    if (/ptt-movie\.json/.test(String(url))) {
      const mode = opts.ptt || "ok";
      const res = (body, status = 200) => Promise.resolve({
        ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body)
      });
      if (mode === "net") return Promise.reject(new TypeError("Failed to fetch"));
      if (mode === "404") return res("<!doctype html><h1>404</h1>", 404);
      if (mode === "bad") return res("<!doctype html>這不是 JSON", 200);
      /* 是合法 JSON、但不是我們要的格式（例如 GitHub Pages 回了別的東西） */
      if (mode === "nomovies") return res(JSON.stringify({ updated: "2026-08-23T00:00:00Z", hello: 1 }));
      const body = JSON.stringify(opts.pttData || pttPayload());
      const d = (opts.delay || {}).ptt || 0;
      if (d) return new Promise(r2 => setTimeout(() => r2({ ok: true, status: 200, text: () => Promise.resolve(body) }), d));
      return res(body);
    }

    const u = new URL(String(url));
    const p = u.pathname, q = u.searchParams;
    const isTmdb = u.hostname === "api.themoviedb.org";

    let dly = (opts.delay || {})[isTmdb ? "tmdb" : "omdb"] || 0;
    if (isTmdb && /\/watch\/providers$/.test(p) && (opts.delay || {}).pv) dly = opts.delay.pv;
    const json = (o, status = 200) => new Promise(res => {
      const val = { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(o)) };
      if (dly) setTimeout(() => res(val), dly); else res(val);
    });

    if (isTmdb) {
      if (fail.tmdb === "net") return Promise.reject(new TypeError("Failed to fetch"));
      if (fail.tmdb === "500") return json({ status_message: "boom" }, 503);
      if (fail.tmdb === "429") return json({ status_message: "rate" }, 429);
      if (q.get("api_key") !== keys.tmdb) return json({ status_code: 7, status_message: "Invalid API key" }, 401);

      if (p === "/3/configuration") return json({ images: {} });
      if (p === "/3/watch/providers/movie") return json({ results: [
        { provider_id: 8, provider_name: "Netflix" },
        /* 官方清單裡「同品牌變體」會排在正牌後面（display_priority 較大）→ 校正時必須先到先贏 */
        { provider_id: 1796, provider_name: "Netflix basic with Ads" },
        { provider_id: 337, provider_name: "Disney Plus" },
        { provider_id: 119, provider_name: "Amazon Prime Video" },
        { provider_id: 159, provider_name: "Catchplay+" },
        { provider_id: 426, provider_name: "friDay影音" },
        { provider_id: 457, provider_name: "MyVideo" }
      ]});
      /* 測試可以用 mock:{nowPlaying:{results:[...]}} 換掉整份電影院片單 */
      if (p === "/3/movie/now_playing") return json(opts.nowPlaying || { results: NOW_PLAYING });
      if (p === "/3/discover/movie") {
        const wp = q.get("with_watch_providers");
        if (wp === "8") return json({ results: DISCOVER_NETFLIX });
        if (wp === "457") return json({ results: [] });          // 篩到沒東西
        return json({ results: DISCOVER });
      }
      if (p === "/3/search/movie") {
        const kw = q.get("query");
        if (kw === "沙丘") return json({ results: [DISCOVER[1]] });
        if (kw === "鐵達尼") return json({ results: [] });
        if (kw === "蜘蛛人") return json({ results: [NOW_PLAYING[0]] });
        if (kw === "復仇者") return json({ results: [EXTRA[0]] });
        if (kw === "小丑") return json({ results: [EXTRA[1]] });
        if (kw === "爛片") return json({ results: [EXTRA[2]] });
        if (kw === "零票") return json({ results: [EXTRA[3]] });
        if (kw === "萬人") return json({ results: [EXTRA[4]] });
        if (kw === "全部") return json({ results: EXTRA.slice(2) });
        return json({ results: [] });
      }
      let m = /^\/3\/movie\/(\d+)\/watch\/providers$/.exec(p);
      if (m) {
        const id = +m[1];
        if (id === 11) return json({ results: { TW: {
          flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg", display_priority: 1 }],
          rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 2 }],
          buy: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 2 }]
        }}});
        if (id === 12) return json({ results: { TW: {
          flatrate: [{ provider_id: 999, provider_name: "Hami Video", logo_path: "/hami.jpg", display_priority: 5 },
                     { provider_id: 119, provider_name: "Amazon Prime Video", logo_path: "/p.jpg", display_priority: 1 }],
          rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 3 },
                 { provider_id: 350, provider_name: "Apple TV Plus", logo_path: "/atvp.jpg", display_priority: 4 }]
        }}});
        if (id === 13) return json({ results: { TW: { flatrate: [
          { provider_id: 1796, provider_name: "Netflix basic with Ads", logo_path: "/nads.jpg", display_priority: 9 },
          { provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg", display_priority: 1 }
        ] } } });
        if (id === 21) return json({ results: {} });              // 未上映：沒有任何管道
        if (id === 22) return json({ results: { TW: {
          rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg" }],
          buy: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg" }]
        }}});
        return json({ results: { TW: { rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg" }] } } });
      }
      m = /^\/3\/movie\/(\d+)$/.exec(p);
      if (m) {
        const id = +m[1];
        const src = [...NOW_PLAYING, ...DISCOVER, ...EXTRA].find(x => x.id === id);
        if (!src) return json({ status_message: "not found" }, 404);
        const zhOverview = id === 5 ? "" : "這是中文簡介，講一個家庭的故事，內容不重要只是要有字。";
        return json({
          ...src,
          runtime: 120,
          genres: [{ name: "劇情" }, { name: "動作" }],
          overview: q.get("language") === "en-US" ? "English fallback overview." : zhOverview,
          imdb_id: id === 5 ? null : "tt000000" + id,
          external_ids: { imdb_id: id === 5 ? null : "tt000000" + id },
          credits: {
            crew: [{ job: "Director", name: "某導演" }],
            cast: [{ name: "演員甲" }, { name: "演員乙" }]
          }
        });
      }
      return json({ status_message: "unknown path " + p }, 404);
    }

    /* OMDb */
    if (fail.omdb === "net") return Promise.reject(new TypeError("Failed to fetch"));
    if (fail.omdb === "limit") return json({ Response: "False", Error: "Request limit reached!" });
    if (q.get("apikey") !== keys.omdb) return json({ Response: "False", Error: "Invalid API key!" }, 401);
    const i = q.get("i");
    if (i === "tt0000004") return json({ Response: "False", Error: "Movie not found!" });   // 台片查不到
    if (i === "tt00000021") return json({ Response: "False", Error: "Movie not found!" });  // 未上映片查不到
    if (i === "tt0000003") return json({ Response: "True", imdbRating: "6.1", Metascore: "N/A",
      Ratings: [{ Source: "Internet Movie Database", Value: "6.1/10" }] });                  // 只有 IMDb
    if (i === "tt0000012") return json({ Response: "True", imdbRating: "8.5",
      Ratings: [{ Source: "Internet Movie Database", Value: "8.5/10" },
                { Source: "Rotten Tomatoes", Value: "92%" },
                { Source: "Metacritic", Value: "79/100" }] });
    if (i === "tt0000001") return json({ Response: "True", imdbRating: "5.1",
      Ratings: [{ Source: "Internet Movie Database", Value: "5.1/10" },
                { Source: "Rotten Tomatoes", Value: "94%" }] });                             // 影評/觀眾分歧
    if (i === "tt00000023") return json({ Response: "True", imdbRating: "3.0", Metascore: "20",
      Ratings: [{ Source: "Internet Movie Database", Value: "3.0/10" },
                { Source: "Rotten Tomatoes", Value: "12%" },
                { Source: "Metacritic", Value: "20/100" }] });
    if (i === "tt0111161") return json({ Response: "True", imdbRating: "9.3", Ratings: [] }); // 測試連線用
    return json({ Response: "True", imdbRating: "7.0",
      Ratings: [{ Source: "Internet Movie Database", Value: "7.0/10" },
                { Source: "Rotten Tomatoes", Value: "80%" }] });
  };
}
export const KEYS = { GOOD_TMDB, GOOD_OMDB };

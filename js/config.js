/* 好雷嗎? — 設定常數
   ⚠️ 這個檔會被 sw.js 用 importScripts() 載入，所以裡面不可以碰 window / document。
   ⚠️ 這裡永遠不會有 API 金鑰。金鑰只存在使用者自己裝置的 localStorage。 */

/* 唯一版本來源：改版就 +1，sw.js 的快取名稱會跟著換 */
var HLM_VER = "1.4.0";

var HLM_CFG = {
  ver: HLM_VER,

  /* API 端點 */
  tmdbBase: "https://api.themoviedb.org/3",
  omdbBase: "https://www.omdbapi.com/",
  imgBase: "https://image.tmdb.org/t/p/",
  imgList: "w200",
  imgDetail: "w400",
  imgLogo: "w45",

  region: "TW",
  lang: "zh-TW",
  timeoutMs: 12000,

  /* PTT 鄉民風向：同源的靜態 JSON，由 GitHub Actions 每天產一次
     ⚠️ 一定要相對路徑（GitHub Pages 站在 /repo-name/ 子路徑底下，開頭 "/" 會 404）
     ⚠️ 這個檔**不進 sw.js 的殼快取**，殼快取跟著 HLM_VER 走，會把它凍到下次改版 */
  pttUrl: "./data/ptt-movie.json",
  pttStaleDays: 3,        /* 超過幾天沒更新就標成過期（用 JSON 裡的 updated 判斷，不是抓取時間） */

  /* 快取 TTL（毫秒） */
  ttl: {
    movie: 30 * 24 * 3600e3,   /* 電影基本資料 30 天 */
    providers: 24 * 3600e3,    /* 觀看平台 1 天 */
    omdb: 7 * 24 * 3600e3,     /* OMDb 分數 7 天 */
    listCinema: 6 * 3600e3,    /* 電影院片單 6 小時 */
    listStream: 6 * 3600e3,    /* 串流片單 6 小時 */
    search: 6 * 3600e3,        /* 搜尋結果 6 小時 */
    providerIds: 30 * 24 * 3600e3
    /* ⚠️ 這裡刻意**沒有** PTT：PTT 資料是 network-first，沒有 TTL 快取。
       「資料新不新」是看 JSON 裡的 updated（門檻 pttStaleDays），不是看什麼時候抓的——
       爬蟲掛掉時 fetch 會成功但 updated 是舊的，用抓取時間判斷會完全看不出來。 */
  },

  /* 快取上限：超過就淘汰最舊的（localStorage 通常只有 5MB） */
  cacheMaxEntries: 400,
  cacheMaxChars: 1200000,

  /* 鑰匙圈（跨 App 身分）：一組密碼解開他所有 App 的金鑰
     ⚠️ appId 一律 ASCII（鑰匙圈的鐵律：中文 id 會在不同系統之間被正規化成兩筆），跟 repo 同名。
     ⚠️ 鑰匙圈一個 App 只吃**一個** localStorage key，我們有 TMDB＋OMDb 兩把，
        所以指到一個**專用的新 key**（存打包好的 JSON blob），解析後才寫進下面那兩把。
        絕對不要把 tokenKey 直接指到 hlm_key_tmdb —— 那樣 OMDb 那把永遠進不來，
        而且鑰匙圈「換人／被收回」時會把他手貼的金鑰一起清掉。 */
  krAppId: "movie-library",
  krAppName: "🎬 好雷嗎",
  krBlobKey: "hlm_keyring_blob",

  /* 申請金鑰的網站 */
  urlTmdbKey: "https://www.themoviedb.org/settings/api",
  urlOmdbKey: "https://www.omdbapi.com/apikey.aspx"
};

/* 平台字典：色塊底色與縮寫（照設計 token）。
   TMDB provider id 是預設值，開機時會用 /watch/providers/movie 依名稱校正一次。 */
var HLM_BRAND = {
  netflix:   { n: "Netflix",     c: "#e50914", s: "N",   id: 8,   match: ["netflix"] },
  disney:    { n: "Disney+",     c: "#1d4ed8", s: "D+",  id: 337, match: ["disney plus", "disney+"] },
  prime:     { n: "Prime Video", c: "#00a8e1", s: "pv",  id: 119, match: ["amazon prime video", "prime video"] },
  catchplay: { n: "CATCHPLAY+",  c: "#c9a200", s: "CP",  id: 159, match: ["catchplay"] },
  friday:    { n: "friDay影音",  c: "#ff6b00", s: "fri", id: 426, match: ["friday"] },
  myvideo:   { n: "MyVideo",     c: "#7c4dff", s: "MV",  id: 457, match: ["myvideo"] },
  apple:     { n: "Apple TV",    c: "#8e8e93", s: "tv",  id: 2,   match: ["apple tv"] },
  /* Apple TV+（訂閱）跟 Apple TV（租買商店）是兩回事，台灣兩個都有。
     沒有分開的話，同一部片會出現兩顆都寫「Apple TV」的標籤。
     ⚠️ 比對靠 api.js 的 brandKeyByName()「最長命中優先」，不是靠這裡的鍵順序。 */
  appletvplus: { n: "Apple TV+",  c: "#8e8e93", s: "tv+", id: 350, match: ["apple tv plus", "apple tv+"] },
  google:    { n: "Google TV",   c: "#34a853", s: "G",   id: 3,   match: ["google play movies", "google tv"] }
};

/* 篩選列只放「他可能有訂閱」的訂閱制平台（Apple TV / Google TV 在台灣主要是租買，不進篩選） */
var HLM_FILTERABLE = ["netflix", "disney", "prime", "catchplay", "friday", "myvideo"];

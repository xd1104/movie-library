import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { ok, section, summary } from "./harness.mjs";
const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const read = f => fs.readFileSync(R + f, "utf8");

section("19. GitHub Pages 子路徑：不可以有絕對路徑");
{
  const idx = read("index.html");
  ok(!/(?:href|src)="\//.test(idx), "index.html 沒有開頭 / 的路徑");
  ok((idx.match(/(?:href|src)="\.\//g) || []).length >= 8, "資源全用 ./ 相對路徑");
  const mf = JSON.parse(read("manifest.webmanifest"));
  ok(mf.start_url === "./" && mf.scope === "./", "manifest start_url／scope 都是 ./");
  ok(mf.icons.every(i => i.src.startsWith("./")), "manifest icon 路徑都是 ./");
  ok(mf.icons.some(i => i.purpose === "maskable"), "有 maskable icon");
  ok(fs.existsSync(R + "icons/icon-180.png"), "有 apple-touch-icon");
  const sw = read("sw.js");
  ok(!/"\/[a-z]/.test(sw.replace(/https?:\/\//g, "")), "sw.js 沒有絕對路徑");
  ok(/register\("\.\/sw\.js", \{ scope: "\.\/" \}\)/.test(read("js/app.js")), "SW 註冊用相對路徑 + 相對 scope");
}

section("20. 版本管理：APP_VER 是唯一來源");
{
  const ver = /var HLM_VER = "([^"]+)"/.exec(read("js/config.js"))[1];
  const sw = read("sw.js");
  ok(/importScripts\("\.\/js\/config\.js"\)/.test(sw), "sw.js 用 importScripts 讀同一份版本號");
  ok(/"hlm-shell-v" \+ HLM_VER/.test(sw), "shell 快取名稱綁 HLM_VER");
  ok(/"hlm-img-v" \+ HLM_VER/.test(sw), "圖片快取名稱也綁 HLM_VER");
  ok(/skipWaiting/.test(sw) && /clients\.claim/.test(sw), "有 skipWaiting + clients.claim");
  ok(/caches\.delete\(k\)/.test(sw), "activate 會清掉舊版本快取");
  ok(read("js/ui.js").includes("C.ver"), "設定頁會顯示版本號 v" + ver);
}

section("21. 金鑰不可以進 repo");
{
  const all = ["index.html", "sw.js", "manifest.webmanifest", "js/config.js", "js/store.js", "js/api.js", "js/ui.js", "js/app.js", "css/app.css"]
    .map(f => read(f)).join("\n");
  ok(!/[0-9a-f]{32}/i.test(all), "沒有任何 32 碼十六進位字串（TMDB key 長相）");
  ok(!/api_key\s*[:=]\s*["'][A-Za-z0-9]{6,}/.test(all), "沒有寫死的 api_key");
  ok(!fs.existsSync(R + ".env") && !fs.existsSync(R + "config.js"), "沒有 .env / config.js 這種放 key 的檔");
  /* 測試檔現在也在 repo 裡，一起掃：假金鑰可以，真金鑰不行 */
  const tests = fs.readdirSync(R + "test").filter(f => f.endsWith(".mjs")).map(f => read("test/" + f)).join("\n");
  ok(!/[0-9a-f]{32}/i.test(tests), "★ 測試檔裡沒有 32 碼十六進位字串（TMDB key 長相）");
  ok(!/\beyJ[A-Za-z0-9_-]{20,}/.test(tests), "★ 測試檔裡沒有真的 JWT");
  ok(/TMDBKEY_GOOD/.test(tests), "測試用的是一看就假的金鑰");
  ok(/hlm_key_tmdb/.test(read("js/store.js")), "金鑰只從 localStorage 讀");
  ok(read(".gitignore").includes(".env"), ".gitignore 擋掉 .env");
}

section("22. iOS 鐵律");
{
  const css = read("css/app.css");
  const bad = [];
  const re = /([^{}]*(?:input|textarea|select)[^{}]*)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const fs2 = /font-size:\s*([\d.]+)px/.exec(m[2]);
    if (fs2 && parseFloat(fs2[1]) < 16) bad.push(m[1].trim() + " → " + fs2[1] + "px");
  }
  ok(bad.length === 0, "所有 input/textarea/select 的 font-size >= 16px", bad.join("; "));
  ok(/\.searchbox input\{[^}]*font-size:17px/.test(css), "搜尋框 17px");
  ok(/\.field input\{[^}]*font-size:17px/.test(css), "設定頁輸入框 17px");
  ok(/env\(safe-area-inset-bottom/.test(css) && /env\(safe-area-inset-top/.test(css), "有 safe-area 內距");
  ok(/viewport-fit=cover/.test(read("index.html")), "viewport 帶 viewport-fit=cover");
  ok(/\.backbtn\{[^}]*min-height:44px/.test(css), "返回鈕 44px");
  ok(/\.btn\{[^}]*min-height:44px/.test(css), "按鈕 44px");
  ok(/\.iconbtn\{[^}]*width:44px;height:44px/.test(css), "齒輪 44px");
  ok(/\.backbar button\{[^}]*min-height:50px/.test(css), "底部返回鈕 50px");
  const idx = read("index.html");
  ok(/<form class="searchbox"[^>]*id="sform"/.test(idx) && /type="submit"/.test(idx), "搜尋用原生 form + submit");
  ok(/enterkeyhint="search"/.test(idx) && /type="search"/.test(idx), "input type=search + enterkeyhint");
  ok(!/keydown|keyCode|which === 13/.test(read("js/app.js")), "★ 沒有自己接 keydown 判斷 Enter（中文注音不會誤送）");
}

section("23. 只查評價、不導購");
{
  const all = ["index.html", "js/ui.js", "js/app.js"].map(f => read(f)).join("\n");
  ok(!/訂票|購票|查場次|立即觀看|前往觀看|去 Netflix|開啟 App/.test(all), "沒有任何導購文案");
  const ui = read("js/ui.js");
  const uiLinks = ui.match(/<a [\s\S]{0,80}?href="' \+ (C\.\w+)/g) || [];
  const anchors = (ui.match(/<a /g) || []).length;
  /* 2026-08-23：PTT 文章連結是老闆指定要的功能，**不在「不導購」禁令裡**（規格 §9.7）。
     界線：出去之後是「繼續讀評價」＝可以；出去之後是「掏錢／播放」＝禁止。
     所以這裡不再只數數量，而是逐一確認每個 <a> 是哪一種。 */
  ok(anchors === 3 && uiLinks.length === 2,
    "全 App 只有 3 個 <a>：2 個申請金鑰 ＋ 1 個 PTT 文章（實際 " + anchors + "）");
  ok(/C\.urlTmdbKey/.test(uiLinks.join()) && /C\.urlOmdbKey/.test(uiLinks.join()), "而且只指向申請金鑰的 TMDB／OMDb 網址");
  ok(/<a class="pttpost" href="' \+ esc\(t\.url\) \+ '" target="_blank" rel="noopener noreferrer"/.test(ui),
    "★ PTT 外連：網址來自資料檔、target=_blank、rel=noopener noreferrer");
  ok(!/href="https?:\/\/(www\.)?(netflix|disneyplus|primevideo|catchplay|friday|myvideo|apple|google|kktix|books)/i.test(ui),
    "★ 沒有任何平台／訂票網站的外連");
  ok(/urlTmdbKey: "https:\/\/www\.themoviedb\.org/.test(read("js/config.js")) && /urlOmdbKey: "https:\/\/www\.omdbapi\.com/.test(read("js/config.js")), "網址正確");
  ok(/class="pv"/.test(read("js/ui.js")) && !/<button class="pv/.test(read("js/ui.js")), "平台是 span 不是 button");
  ok(/\.pv\{[^}]*cursor:default/.test(read("css/app.css")), "平台標籤 cursor:default");
}

section("24. Service Worker 實際跑一遍（Node 模擬）");
{
  const BASE = "https://benson.github.io/hao-lei-ma/";
  const handlers = {};
  const cacheStore = new Map();
  class FakeCache {
    constructor() { this.m = new Map(); }
    async add(req) { this.m.set(typeof req === "string" ? req : req.url, { status: 200, url: req.url || req }); }
    async put(req, res) { this.m.set(typeof req === "string" ? req : req.url, res); }
    async match(req) { return this.m.get(typeof req === "string" ? new URL(req, BASE).href : req.url) || undefined; }
    async keys() { return [...this.m.keys()]; }
    async delete(k) { return this.m.delete(k); }
  }
  const caches = {
    async open(n) { if (!cacheStore.has(n)) cacheStore.set(n, new FakeCache()); return cacheStore.get(n); },
    async keys() { return [...cacheStore.keys()]; },
    async delete(n) { return cacheStore.delete(n); },
    async match(req) { for (const c of cacheStore.values()) { const r = await c.match(req); if (r) return r; } }
  };
  let skipped = false, claimed = false;
  const netCalls = [];
  const sandbox = {
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
      location: { origin: "https://benson.github.io", href: BASE + "sw.js" }
    },
    caches,
    importScripts: () => { vm.runInContext(fs.readFileSync(R + "js/config.js", "utf8"), ctx); },
    fetch: async (req) => { netCalls.push(req.url || req); return { status: 200, type: "basic", clone: () => ({}) }; },
    URL, console,
    Request: class { constructor(u, o) { this.url = new URL(u, BASE).href; this.method = "GET"; this.mode = "cors"; Object.assign(this, o); } },
    Response: class { constructor(b, o) { Object.assign(this, o); } },
    setTimeout
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(R + "sw.js", "utf8"), ctx);
  ok(!!handlers.install && !!handlers.fetch && !!handlers.activate, "三個事件都註冊了");

  // install
  let waited;
  await new Promise(res => { handlers.install({ waitUntil: p => { waited = p; p.then(res); } }); });
  const shellName = [...cacheStore.keys()][0];
  ok(/^hlm-shell-v\d/.test(shellName), "install 建立 shell 快取：" + shellName);
  const cachedKeys = await (await caches.open(shellName)).keys();
  ok(cachedKeys.length >= 10, "殼檔案都快取了（" + cachedKeys.length + " 個）");
  ok(cachedKeys.every(k => k.startsWith(BASE)), "★ 相對路徑正確解析到子路徑底下（不是站台根目錄）");
  ok(skipped, "install 完呼叫 skipWaiting");

  // activate：塞一個舊版本快取進去，看會不會被清
  cacheStore.set("hlm-shell-v0.0.1", new FakeCache());
  await new Promise(res => { handlers.activate({ waitUntil: p => p.then(res) }); });
  ok(![...cacheStore.keys()].includes("hlm-shell-v0.0.1"), "activate 清掉舊版本快取");
  ok(claimed, "activate 呼叫 clients.claim");

  // fetch：API 一律不碰
  let responded = null;
  const ev = url => ({ request: new sandbox.Request(url), respondWith: p => { responded = p; } });
  handlers.fetch(ev("https://api.themoviedb.org/3/movie/now_playing?api_key=x"));
  ok(responded === null, "★ TMDB API 請求：SW 完全不介入（不會拿到舊資料）");
  responded = null;
  handlers.fetch(ev("https://www.omdbapi.com/?apikey=x&i=tt1"));
  ok(responded === null, "★ OMDb API 請求：SW 完全不介入");
  responded = null;
  handlers.fetch(ev("https://image.tmdb.org/t/p/w200/a.jpg"));
  ok(responded !== null, "海報走 SW（cache-first）");
  await responded;
  ok([...cacheStore.keys()].some(k => /^hlm-img-v/.test(k)), "海報存進獨立的圖片快取");
  responded = null;
  handlers.fetch(ev(BASE + "css/app.css"));
  ok(responded !== null, "App 殼走 SW");
  const r = await responded;
  ok(!!r, "殼檔案從快取拿得到（cache-first）");
}

process.exit(summary() ? 1 : 0);

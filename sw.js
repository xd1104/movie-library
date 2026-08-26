/* build 1.4.2 */
/* ⚠️ 上面那行 build 版本字串要跟 js/config.js 的 HLM_VER 一起 +1。
   兩個地方都要改是刻意的：瀏覽器判斷「SW 有沒有更新」是比對 sw.js 本身的位元組，
   只改 importScripts 進來的 config.js 有機會不觸發更新，那個症狀是「老闆永遠拿不到新版」。 */

/* 好雷嗎? — Service Worker
   - 版本唯一來源是 js/config.js 的 HLM_VER，改版就 +1，快取名稱跟著換
   - App 殼 cache-first（開很快）；API 資料一律不進 SW 快取（絕不服務舊分數）
   - 所有路徑都是相對的：GitHub Pages 專案站在 /repo-name/ 子路徑底下，開頭 "/" 會全部 404 */
importScripts("./js/config.js");

var SHELL = "hlm-shell-v" + HLM_VER;
var IMGS = "hlm-img-v" + HLM_VER;
var KEEP = [SHELL, IMGS];

var FILES = [
  "./",
  "./index.html",
  "./css/app.css",
  /* ⚠️ 動效與開場這三個檔**一定要**進殼快取。
     少了它們，離線開啟時 js/splash.js 載不到 → app.js 那邊雖然有
     window.Splash && … 的守衛（不會整支死掉），但畫面會退成「沒有開場」，
     而且 splash.css 沒到位的話 #splash 會是一塊沒套樣式的空白。
     （範本那一輪 QA 實測：裸寫 Splash.hold() ＋ 沒預快取＝開場永遠卡在螢幕上。）
     test/t14-motion.mjs 會**全掃** index.html 引用到的每一個本站 css/js，
     少一個就紅——不是列白名單。 */
  "./css/motion.css",
  "./css/splash.css",
  "./js/splash.js",
  "./js/keyring-unlock.js",
  "./js/config.js",
  "./js/store.js",
  "./js/api.js",
  "./js/ui.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return Promise.all(FILES.map(function (f) {
        return c.add(new Request(f, { cache: "reload" })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        return KEEP.indexOf(k) < 0 ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trim(cacheName, max) {
  caches.open(cacheName).then(function (c) {
    c.keys().then(function (ks) {
      if (ks.length <= max) return;
      for (var i = 0; i < ks.length - max; i++) c.delete(ks[i]);
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* API：一律走網路，永遠不進 SW 快取（省額度的快取在 localStorage，有 TTL 管） */
  if (url.hostname === "api.themoviedb.org" || url.hostname === "www.omdbapi.com" || url.hostname === "omdbapi.com") {
    return;
  }

  /* 海報／平台 logo：cache-first，另開一個有上限的快取 */
  if (url.hostname === "image.tmdb.org") {
    e.respondWith(
      caches.open(IMGS).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.status === 200) { c.put(req, res.clone()); trim(IMGS, 180); }
            return res;
          });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* PTT 資料：**不進殼快取**、也不 cache-first。
     殼快取的名字綁著 HLM_VER，這個檔一天更新一次，進去就會被凍到下次改版才更新
     （症狀：老闆看到的永遠是舊風向，而且沒有人會發現）。
     直接放行走網路；離線時的退路是 localStorage 的離線副本（api.js 的 ptt()）。 */
  if (/\/data\/ptt-movie\.json$/.test(url.pathname)) return;

  /* App 殼：cache-first，沒有才上網 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var cl = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, cl); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504 });
      });
    })
  );
});

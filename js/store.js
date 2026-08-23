/* 好雷嗎? — 儲存層
   1) 偏好設定（分頁／排序／平台篩選／最近查詢）
   2) API 金鑰（只存這台裝置，永遠不進 repo）
   3) API 快取（省額度）：每筆 {t: 寫入時間, v: 內容}，有 TTL、有總量上限與淘汰

   無痕模式／部分 in-app 瀏覽器存取 localStorage 會直接丟例外，
   所以每一個進出點都包 try/catch，失敗時退回「只存在記憶體」，不可以讓 App 白畫面。 */
var HLM_Store = (function () {
  "use strict";

  var PREFIX = "hlm_c:";      /* 快取用的前綴 */
  var mem = {};               /* localStorage 不能用時的退路 */
  var lsOK = (function () {
    try {
      var k = "hlm_t";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function get(k, def) {
    try {
      var v = lsOK ? localStorage.getItem(k) : (k in mem ? mem[k] : null);
      if (v == null) return def;
      return JSON.parse(v);
    } catch (e) { return def; }
  }

  function set(k, v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { return false; }
    mem[k] = s;
    if (!lsOK) return false;
    try { localStorage.setItem(k, s); return true; }
    catch (e) {
      /* 空間不夠：先掃掉一半快取再試一次 */
      if (evict(0.5)) {
        try { localStorage.setItem(k, s); return true; } catch (e2) { }
      }
      return false;
    }
  }

  function del(k) {
    delete mem[k];
    try { if (lsOK) localStorage.removeItem(k); } catch (e) { }
  }

  /* ---------- 快取 ---------- */
  function cacheKeys() {
    var out = [];
    if (!lsOK) {
      for (var mk in mem) if (mk.indexOf(PREFIX) === 0) out.push(mk);
      return out;
    }
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k);
      }
    } catch (e) { }
    return out;
  }

  function entryTime(k) {
    /* 一定要真的解析 JSON：用正則撈 "t":123 會被欄位順序牽著走，
       哪天 stringify 的順序變了，淘汰邏輯會「靜默」失效（不會報錯，只是永遠砍錯東西）。 */
    try {
      var raw = lsOK ? localStorage.getItem(k) : mem[k];
      if (!raw) return 0;
      var o = JSON.parse(raw);
      return o && typeof o.t === "number" ? o.t : 0;
    } catch (e) { return 0; }
  }

  /* 淘汰最舊的 ratio 比例（0~1）；回傳有沒有真的刪到東西 */
  function evict(ratio) {
    var keys = cacheKeys();
    if (!keys.length) return false;
    keys.sort(function (a, b) { return entryTime(a) - entryTime(b); });
    var n = Math.max(1, Math.floor(keys.length * ratio));
    for (var i = 0; i < n; i++) del(keys[i]);
    return true;
  }

  /* 開機掃一次：清掉過期太久的、超過上限的 */
  function sweep() {
    var keys = cacheKeys();
    var chars = 0, i, raw;
    for (i = 0; i < keys.length; i++) {
      try { raw = lsOK ? localStorage.getItem(keys[i]) : mem[keys[i]]; } catch (e) { raw = ""; }
      chars += raw ? raw.length : 0;
    }
    if (keys.length > HLM_CFG.cacheMaxEntries || chars > HLM_CFG.cacheMaxChars) {
      keys.sort(function (a, b) { return entryTime(a) - entryTime(b); });
      var over = Math.max(keys.length - Math.floor(HLM_CFG.cacheMaxEntries * 0.8), Math.ceil(keys.length * 0.3));
      for (i = 0; i < over && i < keys.length; i++) del(keys[i]);
    }
  }

  /* 讀快取；ttl 給 -1 代表不管過期都拿（用於 API 掛掉時的降級） */
  function cacheGet(key, ttl) {
    var e = get(PREFIX + key, null);
    if (!e || typeof e.t !== "number") return null;
    if (ttl >= 0 && Date.now() - e.t > ttl) return null;
    return e;   /* {t, v} — 呼叫端要用 t 顯示「更新於」 */
  }

  function cacheSet(key, val) {
    return set(PREFIX + key, { t: Date.now(), v: val });
  }

  function cacheDel(key) { del(PREFIX + key); }

  function cacheClear() {
    var keys = cacheKeys();
    for (var i = 0; i < keys.length; i++) del(keys[i]);
    /* PTT 的離線副本不在 hlm_c: 命名空間（它不走 TTL／淘汰那一套），
       但按鈕上寫的是「清掉暫存資料」——不一起清掉，語意就是騙人的。 */
    del("hlm_ptt");
  }

  function cacheStats() {
    var keys = cacheKeys(), chars = 0;
    for (var i = 0; i < keys.length; i++) {
      try { var raw = lsOK ? localStorage.getItem(keys[i]) : mem[keys[i]]; chars += raw ? raw.length : 0; } catch (e) { }
    }
    return { n: keys.length, kb: Math.round(chars / 1024) };
  }

  /* ---------- 金鑰 ---------- */
  function keys() {
    return {
      tmdb: String(get("hlm_key_tmdb", "") || "").trim(),
      omdb: String(get("hlm_key_omdb", "") || "").trim()
    };
  }
  function saveKeys(t, o) {
    set("hlm_key_tmdb", String(t || "").trim());
    set("hlm_key_omdb", String(o || "").trim());
  }

  return {
    lsOK: lsOK,
    get: get, set: set, del: del,
    cacheGet: cacheGet, cacheSet: cacheSet, cacheDel: cacheDel,
    cacheClear: cacheClear, cacheStats: cacheStats, sweep: sweep,
    keys: keys, saveKeys: saveKeys
  };
})();

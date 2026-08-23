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
  /* ---------- sessionStorage（鑰匙圈「沒勾記住這台裝置」時用） ----------
     鑰匙圈解鎖時如果沒勾「記住」，它把金鑰寫進 sessionStorage、關掉分頁就沒了（別人的電腦）。
     我們從 blob 解出來的兩把金鑰**必須跟著同一個地方走**，
     不然「借別人手機用一下」會把 TMDB／OMDb 金鑰永久留在那台裝置的 localStorage 裡。 */
  function ssRaw(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { } }
  /* ⚠️ 跟 localStorage 那邊用**同一種編碼**（JSON）。
     一邊存原文一邊存 JSON 的話，下一個人讀哪一邊都會踩到，而且不會報錯、只會拿到怪字串。 */
  function ssGet(k) { try { var v = ssRaw(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* 原始字串（不 JSON.parse）。鑰匙圈寫進來的是一整串原文，
     用 get() 讀會先被 JSON.parse 吃掉，貼錯格式時就拿不到原文來報錯了。 */
  function rawGet(k) {
    var v = ssRaw(k);
    if (v != null) return v;
    try { return lsOK ? localStorage.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return null; }
  }

  function keys() {
    return {
      tmdb: String(ssGet("hlm_key_tmdb") || get("hlm_key_tmdb", "") || "").trim(),
      omdb: String(ssGet("hlm_key_omdb") || get("hlm_key_omdb", "") || "").trim()
    };
  }
  /* 手貼（設定頁）→ 存這台裝置的 localStorage，行為跟以前一樣 */
  function saveKeys(t, o) {
    ssDel("hlm_key_tmdb"); ssDel("hlm_key_omdb");
    set("hlm_key_tmdb", String(t || "").trim());
    set("hlm_key_omdb", String(o || "").trim());
    del("hlm_keys_src");                       /* 手貼的就不算是鑰匙圈給的 */
  }
  /* 鑰匙圈給的 → remember 決定存哪裡，並記下來源（鑰匙圈鎖回去時要清掉，手貼的不能清） */
  function saveKeysFromKeyring(t, o, remember) {
    t = String(t || "").trim(); o = String(o || "").trim();
    if (remember) {
      ssDel("hlm_key_tmdb"); ssDel("hlm_key_omdb");
      set("hlm_key_tmdb", t); set("hlm_key_omdb", o);
    } else {
      del("hlm_key_tmdb"); del("hlm_key_omdb");
      ssSet("hlm_key_tmdb", t); ssSet("hlm_key_omdb", o);
    }
    set("hlm_keys_src", "keyring");
  }
  /* 鑰匙圈換人／被收回／換密碼 → 只清「鑰匙圈給的」，他自己手貼的要留著 */
  function clearKeyringKeys() {
    if (get("hlm_keys_src", "") !== "keyring") return false;
    del("hlm_key_tmdb"); del("hlm_key_omdb");
    ssDel("hlm_key_tmdb"); ssDel("hlm_key_omdb");
    del("hlm_keys_src");
    return true;
  }
  function keysFromKeyring() { return get("hlm_keys_src", "") === "keyring"; }

  /* 鑰匙圈解出來的原始 blob：{raw, remember}；沒有就 null。
     在 sessionStorage ＝ 沒勾「記住這台裝置」（跟模組的 writeToken 同一套規則）。 */
  function keyringBlob() {
    var k = HLM_CFG.krBlobKey;
    var s2 = ssRaw(k);
    if (s2 != null && String(s2).length) return { raw: s2, remember: false };
    var l = rawGet(k);
    return (l != null && String(l).length) ? { raw: l, remember: true } : null;
  }

  return {
    lsOK: lsOK,
    get: get, set: set, del: del,
    cacheGet: cacheGet, cacheSet: cacheSet, cacheDel: cacheDel,
    cacheClear: cacheClear, cacheStats: cacheStats, sweep: sweep,
    keys: keys, saveKeys: saveKeys,
    rawGet: rawGet, keyringBlob: keyringBlob, saveKeysFromKeyring: saveKeysFromKeyring,
    clearKeyringKeys: clearKeyringKeys, keysFromKeyring: keysFromKeyring
  };
})();

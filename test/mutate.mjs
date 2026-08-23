/* 突變驗證：npm run test:mutate
   把每一件「應該被守住的事」各弄壞一次，確認測試真的會紅——
   「有測試」不等於「測試在保護那件事」，這支就是用來證明後者的。
   會暫時改動 js/ 底下的檔案，跑完一定還原，並用 SHA-256 比對確認一模一樣。
   ⚠️ 跑的時候不要同時改專案裡的檔案（雜湊會對不起來）。 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const pExec = promisify(execFile);

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const TESTDIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TESTDIR, "..");
const TESTS = readdirSync(TESTDIR).filter(f => /^t\d+-.*\.mjs$/.test(f)).map(f => f.replace(/\.mjs$/, ""));

const M = [
  ["M40 串流拿掉成人過濾", "js/api.js", "        with_watch_monetization_types: \"flatrate\",\n        with_watch_providers: ids.join(\"|\"),\n        sort_by: \"popularity.desc\",\n        include_adult: false,\n", "        with_watch_monetization_types: \"flatrate\",\n        with_watch_providers: ids.join(\"|\"),\n        sort_by: \"popularity.desc\",\n"],
  ["M41 搜尋拿掉成人過濾", "js/api.js", "query: kw, language: C.lang, region: C.region, include_adult: false, page: 1", "query: kw, language: C.lang, region: C.region, page: 1"],
  ["M45 評價用詞門檻爛掉", "js/ui.js", 'return n >= 85 ? "非常值得看" : (n >= 75 ? "值得看" : (n >= 60 ? "看看可以" : (n >= 45 ? "普通偏弱" : "不太推薦")));', 'return "非常值得看";'],
  ["M46 分數色階失效", "js/ui.js", 'function toneColor(n) { return n >= 75 ? "#41d18a" : (n >= 55 ? "#ffb020" : "#ff5f6b"); }', 'function toneColor(n) { return "#41d18a"; }'],
  ["M26 詳細頁改成等齊才畫", "js/app.js", "      paint();\n      loadPv();\n      if (S.keys().omdb) loadScores();", "      loadPv();\n      if (S.keys().omdb) loadScores(); else paint();"],
  ["M19 0 票也算分數", "js/api.js", "tmdb: votes > 0 && x.vote_average > 0 ?", "tmdb: x.vote_average > 0 ?"],
  ["M48 萬人評換算錯 10 倍", "js/ui.js", 'if (n >= 10000) return (Math.round(n / 1000) / 10) + " 萬人評";', 'if (n >= 10000) return (Math.round(n / 100) / 10) + " 萬人評";'],
  ["M02 淘汰順序反了", "js/store.js", "keys.sort(function (a, b) { return entryTime(a) - entryTime(b); });\n    var n = Math.max", "keys.sort(function (a, b) { return entryTime(b) - entryTime(a); });\n    var n = Math.max"],
  ["M04 寫不下不重試", "js/store.js", "if (evict(0.5)) {", "if (false) {"],
  ["M28 過期降級條件放寬", "js/api.js", 'if (stale && (e.kind === "offline" || e.kind === "timeout" || e.kind === "server" || e.kind === "quota")) {', "if (stale) {"],
  ["M24 拿掉 nokey 守衛", "js/api.js", 'if (!k) return Promise.reject(err("nokey", "tmdb"));', ""],
  ["M09 電影院排序失效", "js/app.js", 'if (state.sort === "pop") return (y.pop || 0) - (x.pop || 0);', 'if (true) return (y.pop || 0) - (x.pop || 0);'],
  ["R1a 只拿掉 pfNames 守衛（層 A 會接住，預期全綠）", "js/app.js", "      var b = HLM_BRAND[state.pf[i]];\n      if (b) out.push(b.n);", "      out.push(HLM_BRAND[state.pf[i]].n);"],
  ["R1b 改回 .then(ok, fail)", "js/app.js", "      if (mode !== \"cinema\") fillProviders(items, seq, mode);\n    }).catch(function (e) {", "      if (mode !== \"cinema\") fillProviders(items, seq, mode);\n    }, function (e) {"],
  ["R2a 第一次安裝就 reload", "js/app.js", "            if (!hadController) return;          /* 第一次安裝，不是更新 */\n            $(\"updatebar\").classList.remove(\"hide\");", "            location.reload();"],
  ["R2b 收到新版自動 reload", "js/app.js", "            if (!hadController) return;          /* 第一次安裝，不是更新 */\n            $(\"updatebar\").classList.remove(\"hide\");", "            if (hadController) location.reload();"],
  ["R3 拿掉同品牌去重", "js/api.js", "        if (seen[b.key]) continue;\n        seen[b.key] = true;\n", ""],
  ["R1c 只拿掉開機清理（層 B 接不到，預期全綠）", "js/app.js", "  /* 認不得的平台 key（舊版留下的、或 TMDB 那邊改名下架）直接丟掉，不要留著當地雷。\n     只在記憶體裡濾掉，不寫回 localStorage。 */\n  state.pf = state.pf.filter(knownBrand);\n", ""],
  ["R1d 兩層守衛都拿掉", "js/app.js", [["  /* 認不得的平台 key（舊版留下的、或 TMDB 那邊改名下架）直接丟掉，不要留著當地雷。\n     只在記憶體裡濾掉，不寫回 localStorage。 */\n  state.pf = state.pf.filter(knownBrand);\n", ""], ["      var b = HLM_BRAND[state.pf[i]];\n      if (b) out.push(b.n);", "      out.push(HLM_BRAND[state.pf[i]].n);"]], null],
  ["N07 拿掉 eyJ 偵測", "js/api.js", "    if (key.indexOf(\"eyJ\") === 0) {", "    if (false) {"],
  ["N09 maskable icon 不進殼快取", "sw.js", ",\n  \"./icons/icon-512-maskable.png\"", ""],
  ["N13 本週門檻改成 70 天", "js/ui.js", "days !== null && days <= 7", "days !== null && days <= 70"],
  ["N14 --faint 調回低對比", "css/app.css", "--faint:#7d8798;", "--faint:#6b7484;"],
  ["N15 ✕ 命中區縮小", "css/app.css", ".chip .x{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;", ".chip .x{display:inline-flex;align-items:center;justify-content:center;width:20px;height:22px;"],
  ["N16a 拿掉 sw.js 的 build 字串", "sw.js", "/* build 1.0.0 */\n", ""],
  ["N16b build 沒跟著 HLM_VER 走", "sw.js", "/* build 1.0.0 */", "/* build 0.9.0 */"],
  ["N34 entryTime 永遠回 0", "js/store.js", "      return o && typeof o.t === \"number\" ? o.t : 0;", "      return 0;"],
  ["N21 去重前不排序", "js/api.js", "      var sorted = (arr || []).slice().sort(function (a, b) {\n        return (a.display_priority || 99) - (b.display_priority || 99);\n      });", "      var sorted = (arr || []).slice();"],
  ["N1a SW 存取搬回頂層（沒保護）", "js/app.js", "  function setupSW() {\n    try {\n      var sw = navigator.serviceWorker;\n      if (!sw || typeof sw.register !== \"function\") return;\n      var hadController = !!sw.controller;", "  function setupSW() {\n    {\n      var sw = navigator.serviceWorker;\n      var hadController = !!navigator.serviceWorker.controller;"],
  ["N2a 沒設過 hlm_pf 不吃 mysubs", "js/app.js", "  if (!Array.isArray(state.pf)) state.pf = state.mysubs.slice();", "  if (!Array.isArray(state.pf)) state.pf = [];"],
  ["D2 品牌比對改回先命中先贏", "js/api.js", "if (nm.indexOf(ms[i]) >= 0 && ms[i].length > bestLen) { best = k; bestLen = ms[i].length; }", "if (nm.indexOf(ms[i]) >= 0 && bestLen === 0) { best = k; bestLen = ms[i].length; }"],
  ["對照組 無害改動（預期全綠）", "js/config.js", 'var HLM_VER = "1.0.0";', 'var HLM_VER = "1.0.0"; /* 註解 */']
];

/* 只雜湊 App 自己的檔案（node_modules 有兩萬個檔，每次都算會慢到不能用） */
const hashAll = () => execFileSync("bash", ["-c",
  `cd ${ROOT} && find . -path ./node_modules -prune -o -type f -print | sort | xargs sha256sum`]).toString();
const BASE = hashAll();
let CUR = null;
const restore = () => { if (CUR) { writeFileSync(CUR.p, CUR.o); CUR = null; } };
for (const s of ["SIGINT", "SIGTERM", "exit"]) process.on(s, restore);

async function runAll() {
  const rs = await Promise.all(TESTS.map(t =>
    pExec("node", [join(TESTDIR, t + ".mjs")], { timeout: 180000, maxBuffer: 8e6 }).then(() => null, () => t)));
  return rs.filter(Boolean);
}

const base = await runAll();
console.log("基準線（沒有突變）：" + (base.length ? "❌ 有測試本來就紅 → " + base.join(",") : "全綠 ✓") + "\n");

const rows = [];
for (const [id, file, from, to] of M) {
  const p = ROOT + "/" + file;
  const o = readFileSync(p, "utf8");
  const pairs = Array.isArray(from) ? from : [[from, to]];
  if (pairs.some(([f]) => o.indexOf(f) < 0)) { rows.push([id, "⚠️ 找不到目標字串（突變沒套用）", ""]); continue; }
  CUR = { p, o };
  let mutated = o;
  for (const [f, t2] of pairs) mutated = mutated.split(f).join(t2);
  writeFileSync(p, mutated);
  process.stderr.write("  跑 " + id + "\n");
  let red = [];
  try { red = await runAll(); } finally { restore(); }
  if (hashAll() !== BASE) { console.error("!!! 還原失敗：" + id); process.exit(2); }
  rows.push([id, red.length ? "紅 ✓" : "❌ 全綠（沒守住）", red.join(",")]);
}

console.log("| 弄壞什麼 | 測試有沒有紅 | 哪個測試檔抓到 |");
console.log("|---|---|---|");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2]} |`);
const miss = rows.filter(r => r[1].startsWith("❌"));
console.log("\n沒守住的：" + (miss.length ? miss.map(r => r[0]).join("、") : "無"));
console.log("還原驗證（SHA-256）：一致 ✓");
/* 名稱裡標了「預期全綠」的是刻意的（縱深防禦的備援層、對照組），其餘全綠就是測試沒守住 */
const unexpected = miss.filter(r => !/預期全綠/.test(r[0]));
console.log(unexpected.length
  ? "\n❌ 有 " + unexpected.length + " 件事沒有測試在守：" + unexpected.map(r => r[0]).join("、")
  : "\n✓ 每一件該守的事都有測試在守（標『預期全綠』的是刻意的備援層／對照組）");
process.exit(unexpected.length ? 1 : 0);

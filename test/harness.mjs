import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFetch, CALLS } from "./mock-api.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["js/config.js", "js/store.js", "js/api.js", "js/ui.js", "js/app.js"];

export async function boot(opts = {}) {
  const html = fs.readFileSync(ROOT + "/index.html", "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) console.error("JSDOM ERROR:", e.message); });
  const dom = new JSDOM(html, {
    url: "https://benson.github.io/hao-lei-ma/",
    runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.fetch = makeFetch(opts.mock || {});
  CALLS.reset();
  if (opts.store) for (const [k, v] of Object.entries(opts.store)) w.localStorage.setItem(k, JSON.stringify(v));
  if (opts.rawStore) for (const [k, v] of Object.entries(opts.rawStore)) w.localStorage.setItem(k, v);
  if (opts.quotaBytes) {
    /* 有容量上限、會丟 QuotaExceededError 的假 localStorage（jsdom 的是 Proxy，覆寫不了 setItem） */
    const m = new Map();
    const api = {
      get length() { return m.size; },
      key(i) { return [...m.keys()][i] ?? null; },
      getItem(k) { return m.has(k) ? m.get(k) : null; },
      setItem(k, v) {
        v = String(v);
        let total = 0;
        for (const [kk, vv] of m) if (kk !== k) total += kk.length + vv.length;
        if (total + k.length + v.length > opts.quotaBytes) {
          const e = new Error("QuotaExceeded"); e.name = "QuotaExceededError"; throw e;
        }
        m.set(k, v);
      },
      removeItem(k) { m.delete(k); },
      clear() { m.clear(); },
      _map: m
    };
    if (opts.store) for (const [k, v] of Object.entries(opts.store)) api.setItem(k, JSON.stringify(v));
    Object.defineProperty(w, "localStorage", { configurable: true, value: api });
  }
  if (opts.breakLS) {
    /* 模擬 Safari 無痕／被封鎖的儲存：連碰 localStorage 都丟例外 */
    Object.defineProperty(w, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  }
  /* 讓測試在載入 App 之前動手腳（例如把 navigator.serviceWorker 弄成 undefined）。
     jsdom 預設根本沒有 navigator.serviceWorker，不先造出「屬性在、值是 undefined」
     這個狀態的話，N-1 那條等於沒測到。 */
  if (opts.beforeEval) opts.beforeEval(w);

  for (const f of FILES) {
    try { w.eval(fs.readFileSync(ROOT + "/" + f, "utf8")); }
    catch (e) { console.error("EVAL FAIL " + f + ": " + e.message); throw e; }
  }
  await tick(w, 30);
  return { w, d: w.document, dom, calls: CALLS };
}

export function tick(w, ms = 20) { return new Promise(r => w.setTimeout(r, ms)); }
export const $ = (d, id) => d.getElementById(id);
export const txt = (d, id) => ($(d, id) ? $(d, id).textContent.replace(/\s+/g, " ").trim() : "<<missing " + id + ">>");
export const html = (d, id) => ($(d, id) ? $(d, id).innerHTML : "<<missing " + id + ">>");

let pass = 0, fail = 0;
export function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (extra ? "\n        → " + String(extra).slice(0, 400) : "")); }
}
export function section(t) { console.log("\n=== " + t + " ==="); }
export function summary() {
  console.log("\n---------------------------------------");
  console.log("PASS " + pass + " / FAIL " + fail);
  return fail;
}

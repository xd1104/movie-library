/* 同一個 Chrome 內、多目標交錯取樣，降低跨行程漂移。
   node bench.mjs --reps=15 --cpu=4 --net=none --sw=1 -- 8081:HEAD 8091:E1 ...

   --sw=1   先幫每個目標裝好 Service Worker 再量（＝已安裝的 PWA 熱啟動）
   --sw=0   不預裝，但同一個 profile 會累積快取／SW ⇒ 只有第一次是真的冷
   --cold=1 ⭐ 每一次取樣前都把該來源的 cache / SW / storage 清乾淨
            （＝Benson 用 Safari 第一次開那個網址、或剛清過資料的情境）
            會多印兩欄自證：SW? 這一次的文件是不是 SW 給的、下載KB 實際下載量。
            冷啟動時 SW? 必須是 no、下載KB 必須 > 0，否則就是尺壞了。 */
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { CDP } from "./cdp.mjs";
import { decodePNG, pixel, hex } from "./png.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const argv = process.argv.slice(2);
const cut = argv.indexOf("--");
const A = Object.fromEntries(argv.slice(0, cut).map(s => { const [k, v] = s.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const TARGETS = argv.slice(cut + 1).map(s => { const [p, n] = s.split(":"); return { p, n, url: `http://127.0.0.1:${p}/index.html` }; });
const REPS = Number(A.reps || 15), CPU = Number(A.cpu || 1), NET = A.net || "none";
const COLD = A.cold === "1" || A.cold === true;
const SW = !COLD && A.sw !== "0";
const DEV = Number(A.dev || 9800);
const WAIT = Number(A.wait || 7000);
const NETS = { none: null, "4g": { latency: 20, downloadThroughput: 1179648, uploadThroughput: 1179648 },
               "3g": { latency: 300, downloadThroughput: 89600, uploadThroughput: 32000 },
               "slow3g": { latency: 400, downloadThroughput: 50000, uploadThroughput: 25000 } };

const PROFILE = path.join(os.tmpdir(), "hlm-bench-" + DEV);
fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEV, "--user-data-dir=" + PROFILE,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore", shell: false });
process.on("exit", () => { try { chrome.kill(); } catch (e) {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitPort() { for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${DEV}/json/version`); return; } catch (e) {} await sleep(100); } throw new Error("no devtools"); }
async function newTab() {
  const t = await (await fetch(`http://127.0.0.1:${DEV}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  return { cdp: new CDP(ws), id: t.id };
}
async function closeTab(t) { try { t.cdp.close(); } catch (e) {} try { await fetch(`http://127.0.0.1:${DEV}/json/close/${t.id}`); } catch (e) {} }

/* 把一個來源徹底清乾淨：SW、Cache Storage、local/sessionStorage、HTTP 快取。
   這是「冷啟動」量測的尺，清不乾淨就會量到熱啟動。 */
async function wipe(c, origin) {
  try { await c.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" }); } catch (e) {}
  try { await c.send("Network.clearBrowserCache"); } catch (e) {}
  try { await c.send("Network.clearBrowserCookies"); } catch (e) {}
}

async function measure(url) {
  const origin = new URL(url).origin;
  const t = await newTab();
  const c = t.cdp;
  await c.send("Page.enable"); await c.send("Network.enable");
  await c.send("Page.setLifecycleEventsEnabled", { enabled: true });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  if (COLD) await wipe(c, origin);
  await c.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NETS[NET]) await c.send("Network.emulateNetworkConditions", { offline: false, ...NETS[NET] });
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__m={s:null,g:null};(function k(){var e=document.getElementById("splash");
      if(e&&window.__m.s===null)window.__m.s=performance.now();
      if(!e&&window.__m.s!==null&&window.__m.g===null)window.__m.g=performance.now();
      requestAnimationFrame(k);})();`
  });
  const life = []; let navMono = null, navWall = null; let first = null; let nFrames = 0;
  let docFromSW = null, bytes = 0;
  c.on("Page.lifecycleEvent", p => life.push([p.name, p.timestamp]));
  c.on("Network.requestWillBeSent", p => { if (p.type === "Document" && navMono === null) { navMono = p.timestamp; navWall = p.wallTime; } });
  c.on("Network.responseReceived", p => { if (p.type === "Document" && docFromSW === null) docFromSW = !!p.response.fromServiceWorker; });
  c.on("Network.loadingFinished", p => { bytes += p.encodedDataLength || 0; });
  c.on("Page.screencastFrame", async p => {
    nFrames++;
    if (!first && nFrames > 0) { first = { wall: p.metadata.timestamp, b64: p.data }; }
    try { await c.send("Page.screencastFrameAck", { sessionId: p.sessionId }); } catch (e) {}
  });
  await c.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(250); first = null; nFrames = 0;
  await c.send("Page.navigate", { url });
  await sleep(WAIT);
  try { await c.send("Page.stopScreencast"); } catch (e) {}
  const ev = await c.send("Runtime.evaluate", { expression: "JSON.stringify(window.__m)", returnByValue: true });
  const m = JSON.parse(ev.result.value || "{}");
  const rel = t2 => t2 == null ? null : +((t2 - navMono) * 1000).toFixed(1);
  const g = n => { const e = life.find(l => l[0] === n); return e ? rel(e[1]) : null; };
  let corner = null, ft = null;
  if (first) {
    try { const img = decodePNG(Buffer.from(first.b64, "base64")); corner = hex(pixel(img, 4, 4)); } catch (e) { corner = "err"; }
    ft = +(((first.wall - (navWall - navMono)) - navMono) * 1000).toFixed(1);
  }
  if (COLD) await wipe(c, origin);
  await closeTab(t);
  return { fp: g("firstPaint"), fcp: g("firstContentfulPaint"), dcl: g("DOMContentLoaded"),
           frameT: ft, corner, sw: docFromSW, bytes,
           splashMs: (m.s != null && m.g != null) ? +(m.g - m.s).toFixed(1) : null };
}

const q = (v, p) => v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null;
(async () => {
  await waitPort();
  { const t = await newTab(); await t.cdp.send("Page.enable"); await t.cdp.send("Page.navigate", { url: TARGETS[0].url.replace("/index.html", "/icons/icon-192.png") }); await sleep(1200); await closeTab(t); }
  if (SW) for (const t of TARGETS) { const tab = await newTab(); await tab.cdp.send("Page.enable"); await tab.cdp.send("Page.navigate", { url: t.url }); await sleep(3000); await closeTab(tab); }
  const acc = new Map(TARGETS.map(t => [t.n, []]));
  for (let r = 0; r < REPS; r++) { const order=[...TARGETS].sort(()=>Math.random()-0.5); for (const t of order) acc.get(t.n).push(await measure(t.url)); }
  console.log(`情境 reps=${REPS} cpu=x${CPU} net=${NET} ${COLD ? "cold=全清(冷啟動)" : (SW ? "sw=走SW(熱啟動)" : "sw=不預裝")}`);
  console.log("目標".padEnd(18) + " | FP min |  p25  |  中位 |  p75  | 首幀色    | 首幀ms | 開場停留 | SW? | 下載KB");
  for (const [n, rows] of acc) {
    const fp = rows.map(x => x.fp).filter(x => x != null).sort((a, b) => a - b);
    const sm = rows.map(x => x.splashMs).filter(x => x != null).sort((a, b) => a - b);
    const ff = rows.map(x => x.frameT).filter(x => x != null).sort((a, b) => a - b);
    const kb = rows.map(x => x.bytes).sort((a, b) => a - b);
    const cols = [...new Set(rows.map(x => x.corner))].join("/");
    const sws = [...new Set(rows.map(x => x.sw === null ? "?" : (x.sw ? "yes" : "no")))].join("/");
    console.log(n.padEnd(18) + " | " + String(fp[0]).padStart(6) + " | " + String(q(fp, .25)).padStart(5) + " | " +
      String(q(fp, .5)).padStart(5) + " | " + String(q(fp, .75)).padStart(5) + " | " + String(cols).padStart(9) +
      " | " + String(q(ff, .5)).padStart(6) + " | " + String(q(sm, .5)).padStart(8) +
      " | " + String(sws).padStart(3) + " | " + String((q(kb, .5) / 1024).toFixed(1)).padStart(6));
  }
  chrome.kill(); process.exit(0);
})().catch(e => { console.error("BENCH FAIL", e); try { chrome.kill(); } catch (x) {} process.exit(1); });

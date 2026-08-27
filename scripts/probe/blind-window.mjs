/* blind-window.mjs — 驗「開場在畫面真的被交到使用者眼前之前，有沒有已經演掉一段」
   ------------------------------------------------------------------
   為什麼要有它（v1.6.2，2026-08-27）：
     t14 §75c 與 first-frame.mjs 比的是「第一幀 vs @keyframes 的 from」。
     那一把尺**抓不到這個病**——背景的 from 確實就是 --sp-start，
     問題出在「動畫的時間已經走掉一段」。

     Benson 的螢幕錄影逐格（59.94fps）：iOS 自己的啟動畫面還在平順淡向白
     （#c6c6c6 → #cdcdcd → #d4d4d4，每格 +7），下一格突然掉到 #949494，
     之後又順順變深（#8f8f91 → #858487 → #5c5d61）。
     #949494 ＝「#ebebeb → #0b0d12」這條漸深走到約四成的位置
     ⇒ 畫面被交出來的時候，我們的漸深已經跑了約 280ms
     ⇒ iOS 還在播它自己的東西時，我們的網頁已經在後面繪製並且開始跑動畫了。

   量法（三個自證，缺一不可）：
     ① 取樣點用**頁面自己的時鐘**（performance.now()），從「三支 link 的 media 都變成 all」
        那一刻起算 —— 不是用外部時鐘猜「大概什麼時候」。
     ② 真的截一張圖、真的讀那個像素（不是用 opacity 反推顏色）。
        ⚠️ 截圖從 node 發指令到真的拍到，實測會拖 30～90ms —— 那段時間動畫還在跑，
        量到的會是「更後面」的顏色。所以「可見那一刻」到的時候頁面**先把所有動畫暫停**
        （document.getAnimations().pause()），截圖才拍得到那一刻的真實像素；
        拍完再驗一次 opacity 沒變，證明真的凍住了。
     ③ **負控組**：把 --sp-lead 那一拍拿掉（＝ v1.6.1 的行為）再量一次，
        這把尺必須翻紅，而且量到的顏色會落在 Benson 錄影的那個灰附近。

   用法：
     node scripts/probe/blind-window.mjs
     node scripts/probe/blind-window.mjs --blind=280 --delay=700
   exit 0 ＝ 過；1 ＝ 可見那一刻動畫已經推進；2 ＝ 尺壞了（沒取到樣、找不到 Chrome…）
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { CDP } from "./cdp.mjs";
import { decodePNG, pixel, hex } from "./png.mjs";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const A = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const PORT = Number(A.port || 8183);
const DEV = Number(A.dev || 9783);
const ROOT = path.resolve(import.meta.dirname, "../..");
/* 人為延遲 CSS：把「第一次繪製 → splash.css 套用」的窗口撐開，取樣點才抓得準 */
const CSS_DELAY = Number(A.delay || 700);
/* 盲窗：畫面繪製之後，還要過多久才真的被交到使用者眼前（Benson 錄影實測約 273ms） */
const BLIND = Number(A.blind || 280);
/* 起始色：直接從 css/splash.css 讀，不要在這裡抄第二份 */
const SPLASHCSS = fs.readFileSync(path.join(ROOT, "css/splash.css"), "utf8");
const START = (/--sp-start:\s*(#[0-9a-fA-F]{3,8})/.exec(SPLASHCSS) || [])[1];

if (!START) { console.log("[尺壞了] css/splash.css 裡讀不到 --sp-start"); process.exit(2); }
if (!fs.existsSync(CHROME)) {
  console.log("[未能執行] 找不到 Chrome：" + CHROME + "（設環境變數 CHROME 指到執行檔）");
  console.log("           這支沒跑 ＝「開場有沒有偷跑」沒有被真瀏覽器驗過，不要當成通過。");
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 極簡靜態站：可以延遲 CSS，也可以改寫 splash.css（負控組用） ---- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png"
};
let rewriteCss = null;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  const send = () => fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("404"); return; }
    let body = buf;
    if (/splash\.css$/.test(p) && rewriteCss) body = Buffer.from(rewriteCss(buf.toString("utf8")), "utf8");
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  });
  if (/\.css$/.test(p)) { setTimeout(send, CSS_DELAY); } else { send(); }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));

/* ---- 頁面裡的取樣器 ----
   逐 rAF 記錄；一看到「三支 link 的 media 都變成 all」就把那一刻記成 applyT，
   再由頁面自己排一個 BLIND 毫秒之後的旗標（__visReady）——
   「可見那一刻」是頁面時鐘決定的，node 只負責看到旗標就截圖。 */
const SAMPLER = blind => [
  "window.__S = []; window.__applyT = null; window.__visReady = 0; window.__visT = null;",
  "window.__frozen = 0;",
  "(function(){",
  "  function applied(){",
  "    var ls = [].slice.call(document.querySelectorAll('link[data-splash-css]'));",
  "    return ls.length > 0 && ls.every(function(l){ return l.media === 'all'; });",
  "  }",
  "  function snap(){",
  "    var sp = document.getElementById('splash');",
  "    if (!sp) return null;",
  "    var g = document.querySelector('.sp-glyph'), n = document.querySelector('.sp-name');",
  "    return {",
  "      sink: getComputedStyle(sp, '::before').opacity,",
  "      go: g ? getComputedStyle(g).opacity : null,",
  "      no: n ? getComputedStyle(n).opacity : null,",
  "      htmlbg: getComputedStyle(document.documentElement).backgroundColor",
  "    };",
  "  }",
  "  window.__snapAfter = snap;",
  "  function loop(){",
    "    var s = snap();",
  "    if (s) {",
  "      s.t = Math.round(performance.now());",
  "      s.applied = applied();",
  "      window.__S.push(s);",
  "      if (window.__applyT === null && s.applied) {",
  "        window.__applyT = performance.now();",
  "        setTimeout(function(){",
  "          window.__visT = performance.now();",
  "          try { document.getAnimations().forEach(function(a){ a.pause(); }); window.__frozen = document.getAnimations().length; } catch (e) { window.__frozen = -1; }",
  /* 暫停之後要再等一幀讓樣式重算落定，量到的才是「凍住之後」的穩定值
     （直接讀會拿到還沒 flush 的上一幀，跟截圖差半幀 ⇒ 自證會誤報凍結失敗）。
     多等的這一幀只會讓取樣點更晚 ＝ 更嚴格，不會放水。 */
  "          requestAnimationFrame(function(){ window.__vis = snap(); window.__visReady = 1; });",
  "        }, " + blind + ");",
  "      }",
  "    }",
  "    requestAnimationFrame(loop);",
  "  }",
  "  requestAnimationFrame(loop);",
  "})();"
].join("\n");

let runNo = 0;
async function measure(label) {
  const profile = path.join(os.tmpdir(), "hlm-blindwin-" + DEV + "-" + (++runNo));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  /* ⚠️ --user-data-dir 一定要指到暫存資料夾（不然會去搶使用者正在用的 profile） */
  const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEV,
    "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "about:blank"], { stdio: "ignore", shell: false });
  try {
    for (let i = 0; i < 200; i++) {
      try { await fetch("http://127.0.0.1:" + DEV + "/json/version"); break; } catch (e) { await sleep(100); }
    }
    const t = await (await fetch("http://127.0.0.1:" + DEV + "/json/new?about:blank", { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener("open", r));
    const c = new CDP(ws);
    await c.send("Page.enable");
    await c.send("Network.enable");
    await c.send("Network.setBlockedURLs", {
      urls: ["*themoviedb.org*", "*omdbapi.com*", "*tmdb.org*", "*github.io*", "*githubusercontent.com*"]
    });
    await c.send("Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER(BLIND) });
    await c.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
    /* 等頁面自己說「盲窗過完了」，看到旗標立刻截圖（旗標是頁面時鐘排的，不是外部猜的） */
    let waited = 0, ready = false;
    while (waited < CSS_DELAY + BLIND + 6000) {
      const r = await c.send("Runtime.evaluate", { expression: "window.__visReady|0", returnByValue: true });
      if (r.result.value === 1) { ready = true; break; }
      await sleep(4); waited += 4;
    }
    let shot = null, at = null;
    if (ready) {
      const png = await c.send("Page.captureScreenshot", { format: "png" });
      shot = decodePNG(Buffer.from(png.data, "base64"));
      const r2 = await c.send("Runtime.evaluate", {
        expression: "JSON.stringify({visT:window.__visT, applyT:window.__applyT, now:performance.now(), frozen:window.__frozen, vis:window.__vis, after:window.__snapAfter()})",
        returnByValue: true
      });
      at = JSON.parse(r2.result.value);
    }
    const r = await c.send("Runtime.evaluate",
      { expression: "JSON.stringify(window.__S)", returnByValue: true });
    c.close();
    return { label, ready, shot, at, samples: JSON.parse(r.result.value) };
  } finally {
    ch.kill();
  }
}

/* 兩個取樣座標：都必須落在純底色上（不可以碰到符號或名字） */
const PTS = [[195, 60], [40, 300]];

function analyse(res) {
  const out = { label: res.label, bad: [], colors: [], n: res.samples.length };
  if (!res.ready) { out.bad.push("尺壞了：頁面沒有回報「盲窗過完了」（__visReady 一直是 0）"); return out; }
  if (out.n < 5) { out.bad.push("尺壞了：只取到 " + out.n + " 個樣本"); return out; }
  if (res.samples[0].applied) {
    out.bad.push("尺壞了：第一個樣本就已經套用 CSS（--delay 太短，窗口沒撐開）"); return out;
  }
  if (!res.shot) { out.bad.push("尺壞了：沒截到圖"); return out; }
  out.lag = Math.round(res.at.now - res.at.visT);
  out.applyT = Math.round(res.at.applyT);
  out.frozen = res.at.frozen;
  /* 自證①：可見那一刻真的有動畫可以凍（0 條＝根本沒在動，那量什麼都會過） */
  if (!(res.at.frozen > 0)) {
    out.bad.push("尺壞了：可見那一刻 document.getAnimations() 只有 " + res.at.frozen +
      " 條 ⇒ 沒有動畫在跑，這一輪量到的「沒推進」不算數");
    return out;
  }
  /* 自證②：截圖比旗標晚了 lag 毫秒，但畫面必須是凍住的
     —— 在「可見那一刻」與「截圖之後」各讀一次 computed style，逐項相同才算真的凍住 */
  const vis = res.at.vis, after = res.at.after;
  if (!vis || !after) { out.bad.push("尺壞了：可見那一刻／截圖後取不到 computed style"); return out; }
  const drift = ["sink", "go", "no"].filter(k => String(vis[k]) !== String(after[k]));
  if (drift.length) {
    out.bad.push("尺壞了：凍結沒生效（" + drift.map(k =>
      k + " " + vis[k] + " → " + after[k]).join("、") + "），截圖晚了 " + out.lag +
      "ms ⇒ 拍到的不是那一刻");
    return out;
  }
  out.colors = PTS.map(p => hex(pixel(res.shot, p[0], p[1])));
  out.colors.forEach((c, i) => {
    if (c.toLowerCase() !== START.toLowerCase()) {
      out.bad.push("可見那一刻（CSS 套用後 " + BLIND + "ms）座標 " + PTS[i].join(",") +
        " 的底色是 " + c + "，不是起始色 " + START + " ⇒ 開場在使用者看到之前已經演掉一段");
    }
  });
  /* 第二把尺（跟像素互相獨立）：那一刻三條進場動畫的 computed opacity 都必須還是 0 */
  out.sink = vis.sink; out.go = vis.go; out.no = vis.no;
  if (Number(vis.sink) !== 0) {
    out.bad.push("可見那一刻 #splash::before 的 opacity 已經是 " + vis.sink + "（應該還是 0）");
  }
  if (Number(vis.go) !== 0) out.bad.push("可見那一刻符號的 opacity 已經是 " + vis.go + "（應該還是 0）");
  if (Number(vis.no) !== 0) out.bad.push("可見那一刻名字的 opacity 已經是 " + vis.no + "（應該還是 0）");
  return out;
}

console.log("量測條件：390x844、CSS 人為延遲 " + CSS_DELAY + "ms、盲窗 " + BLIND +
  "ms（從 splash.css 套用起算）、外部主機全擋、起始色 " + START + "\n");

const real = analyse(await measure("現行版"));
console.log("=== 現行版 ===");
console.log("  樣本 " + real.n + " 幀；CSS 套用於 t=" + real.applyT + "ms；旗標→截圖 " + real.lag + "ms；凍住 " + real.frozen + " 條動畫");
console.log("  可見那一刻的底色：" + real.colors.join(" / ") +
  "（漸深 opacity=" + real.sink + "、符號=" + real.go + "、名字=" + real.no + "）");
real.bad.forEach(m => console.log("  [錯誤] " + m));
if (!real.bad.length) console.log("  OK 使用者看到的第一幀仍然是起始狀態");

/* ---- 負控組：把白起那一拍（--sp-lead 的 delay）拿掉 ＝ 退回 v1.6.1 的行為 ---- */
rewriteCss = src => src
  .replace("animation:sp-sink-bg var(--sp-sink) linear var(--sp-lead) forwards;",
    "animation:sp-sink-bg var(--sp-sink) linear forwards;")
  .replace("animation:sp-sink var(--sp-sink) linear var(--sp-lead) forwards;",
    "animation:sp-sink var(--sp-sink) linear forwards;")
  .replace("animation:sp-emerge calc(var(--dur-3) + var(--dur-1)) var(--ease) both var(--sp-lead);",
    "animation:sp-emerge calc(var(--dur-3) + var(--dur-1)) var(--ease) both;")
  .replace("animation:sp-up var(--dur-3) var(--ease) both calc(var(--sp-lead) + var(--sp-sink));",
    "animation:sp-up var(--dur-3) var(--ease) both var(--sp-sink);");
{
  /* 自證：改寫真的套用了（目標字串失配就會安靜地量出「兩版一樣」的假綠燈） */
  if (rewriteCss(SPLASHCSS) === SPLASHCSS) {
    console.log("\n[尺壞了] 負控組的改寫沒有套用（目標字串失配）⇒ 兩次量的是同一份程式。");
    server.close(); process.exit(2);
  }
}
const neg = analyse(await measure("負控組"));
rewriteCss = null;
console.log("\n=== 負控組：拿掉 --sp-lead 那一拍（＝ v1.6.1 的行為）===");
console.log("  可見那一刻的底色：" + neg.colors.join(" / ") + "（漸深 opacity=" + neg.sink + "）");
neg.bad.forEach(m => console.log("  抓到：" + m));

server.close();
let bad = 0;
if (real.bad.length) { console.log("\n[未過] 使用者看到的第一幀已經不是起始狀態。"); bad = 1; }
if (!neg.bad.length) { console.log("\n[尺壞了] 負控組（沒有那一拍）竟然也過關 ＝ 這支量的東西是恆綠的。"); bad = 2; }
if (!bad) {
  console.log("\n[通過] 現行版在盲窗結束時仍是起始色 " + START +
    "；負控組被抓到 " + neg.bad.length + " 條（實測底色 " + neg.colors.join(" / ") + "）⇒ 這把尺會紅。");
}
process.exit(bad);

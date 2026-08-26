/* 取一張畫面、取樣幾個座標，確認開場長對了：node shot.mjs <url> <delayMs> [devPort] */
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { CDP } from "./cdp.mjs";
import { decodePNG, pixel, hex } from "./png.mjs";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [URL_, DELAY, DEV = "9899"] = process.argv.slice(2);
const P = path.join(os.tmpdir(), "hlm-shot-" + DEV);
fs.rmSync(P, { recursive: true, force: true });
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEV, "--user-data-dir=" + P,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore", shell: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${DEV}/json/version`); break; } catch (e) { await sleep(100); } }
const t = await (await fetch(`http://127.0.0.1:${DEV}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
const c = new CDP(ws);
await c.send("Page.enable");
await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await c.send("Page.navigate", { url: URL_ });
await sleep(Number(DELAY));
const shot = await c.send("Page.captureScreenshot", { format: "png" });
const img = decodePNG(Buffer.from(shot.data, "base64"));
const pts = [["左上角", 4, 4], ["方塊中心", 195, 422], ["方塊右上(gold)", 220, 400], ["方塊外緣上方", 195, 375],
  ["名字那一行", 195, 500], ["畫面底部", 195, 830]];
console.log("畫面 " + img.w + "x" + img.h + " @ " + DELAY + "ms  " + URL_);
for (const [n, x, y] of pts) console.log("  " + n.padEnd(16) + hex(pixel(img, x, y)));
fs.writeFileSync(path.join(import.meta.dirname, "shot-" + DEV + ".png"), Buffer.from(shot.data, "base64"));
ch.kill(); process.exit(0);

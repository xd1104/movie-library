/* 一次跑完全部測試：npm test
   每支測試檔都是獨立的 node 程序（互不污染 localStorage 與全域），最後印總計。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pExec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

const FILES = readdirSync(HERE)
  .filter(f => /^t\d+-.*\.mjs$/.test(f))
  .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

const NAME = {
  "t1-firstrun": "第一次使用／設定金鑰",
  "t2-list": "片單、分頁、平台篩選、搜尋",
  "t3-detail": "詳細頁與 15 種狀態",
  "t4-errors": "錯誤分類與降級",
  "t5-static-sw": "靜態檢查（路徑／iOS／不導購）",
  "t6-flow": "端到端流程",
  "t7-budget": "API 用量",
  "t8-regress": "迴歸（QA 退件後補）",
  "t9-storage": "快取淘汰與過期降級",
  "t10-guards": "守衛（N-1/N-2 與交辦項目）"
};

const results = await Promise.all(FILES.map(async f => {
  const id = f.replace(/\.mjs$/, "");
  const t0 = Date.now();
  let out = "", okRun = true;
  try {
    const r = await pExec("node", [join(HERE, f)], { timeout: 180000, maxBuffer: 8e6 });
    out = r.stdout;
  } catch (e) {
    okRun = false;
    out = (e.stdout || "") + (e.stderr || "");
  }
  const m = /PASS (\d+) \/ FAIL (\d+)/.exec(out);
  const pass = m ? +m[1] : 0, fail = m ? +m[2] : 0;
  const fails = out.split("\n").filter(l => /^\s*FAIL/.test(l));
  return { id, pass, fail, fails, crashed: !m, ms: Date.now() - t0, out, okRun };
}));

let P = 0, F = 0, bad = 0;
console.log("\n好雷嗎? — 測試\n");
for (const r of results) {
  P += r.pass; F += r.fail;
  const label = NAME[r.id] || r.id;
  if (r.crashed) {
    bad++;
    console.log(`  ✗ ${r.id.padEnd(14)} 程序掛掉　${label}`);
    console.log(r.out.split("\n").slice(-8).map(l => "      " + l).join("\n"));
    continue;
  }
  if (r.fail) bad++;
  console.log(`  ${r.fail ? "✗" : "✓"} ${r.id.padEnd(14)} ${String(r.pass).padStart(3)} 過 / ${String(r.fail).padStart(2)} 失敗  ${String(r.ms + "ms").padStart(7)}   ${label}`);
  for (const l of r.fails) console.log("      " + l.trim());
}
console.log("\n" + "─".repeat(52));
console.log(`  ${bad ? "有測試沒過" : "全部通過"}：共 ${P + F} 個斷言，${P} 過 / ${F} 失敗，${FILES.length} 支測試檔`);
console.log("─".repeat(52) + "\n");
process.exit(bad ? 1 : 0);

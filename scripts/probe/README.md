# scripts/probe — 用真 Chrome 量「第一次繪製」的探針

> 2026-08-26 為了查 Benson 回報的「iPhone 開 App 先閃一下白色」而寫的。
> **開發用工具，不是上線的一部分**：純 Node、零相依（Node 22 內建的 `WebSocket` ＋ `zlib`），
> 不會被 `index.html` 引用，也不在 `sw.js` 的殼快取裡。
> 結論與數字寫在專案 `CLAUDE.md` 第 31 條。

## 為什麼要留著

`npm test` 用 jsdom，量不到 first paint、量不到「第一次畫出來的那一幀是什麼顏色」。
而白閃這一類問題**只有逐幀取樣抓得到**（`--headless=new --dump-dom` 那種一次性快照不行，
它拿到的是「全部載完之後」的 DOM，時序資訊整個不見了）。
把方法留成可重跑的入口，下一個人才有辦法複驗 CLAUDE.md 第 31 條那些數字。

## 怎麼跑

```bash
# 1) 靜態站要跑在「另一個行程」（execFileSync 會鎖住 Node 事件迴圈，同行程的 server 回不了請求）
node scripts/probe/server.mjs . 8083 &

# 2) 交錯取樣比較兩個版本（同一個 Chrome、每輪隨機打散順序）
node scripts/probe/bench.mjs --reps=15 --cpu=4 --net=none --sw=1 -- 8083:改後 8081:改前

# 3) 取一張畫面、取樣幾個座標（確認開場真的長對了）
node scripts/probe/shot.mjs http://127.0.0.1:8083/index.html 450
```

`bench.mjs` 參數：`--reps` 每個目標跑幾次／`--cpu` CPU 節流倍率／
`--net none|4g|3g|slow3g`（`4g` 1.18MB/s・20ms、`3g` 89.6KB/s・300ms、`slow3g` 50KB/s・400ms）／
`--wait` 每次取樣等多久（慢網路要拉長，不然開場停留量不到）／`--dev` devtools port，
以及**兩種啟動情境**（很重要，結論會完全相反）：

| 旗標 | 情境 | 對應到 Benson 的哪一次 |
|---|---|---|
| `--sw=1` | 先幫每個目標裝好 Service Worker 再量 | 已加到主畫面、天天在用的 PWA（熱啟動） |
| `--cold=1` | **每一次取樣前**把該來源的 SW／Cache Storage／localStorage／HTTP 快取全清掉 | 用 Safari 第一次開那個網址、或快取被清掉 |

⚠️ `--sw=0` **不等於冷啟動**：同一個 profile 會累積快取與 SW，只有第一次是真的冷。
要量冷啟動一定要用 `--cold=1`。

輸出欄位：`FP` first paint（相對導航開始，ms）、`首幀色` 第一幀左上角的實際像素、
`首幀ms` 第一張螢幕影格的時間、`開場停留` `#splash` 從出現到從 DOM 消失、
**`SW?`／`下載KB` 是尺的自證**——`--cold=1` 時 `SW?` 必須是 `no`、`下載KB` 必須 > 0，
不然就是沒真的清乾淨（「以為在量冷啟動、其實量到熱啟動」不會有任何徵兆）。

## ⚠️ 三個雷（踩過才寫的）

1. **一定要 `--user-data-dir` 指到暫存資料夾**，否則會去搶 Benson 正在用的 Chrome profile 而整個卡住。
   `bench.mjs`／`shot.mjs` 已經寫死指到 `os.tmpdir()`，**不要改掉**。
2. **量之前先修尺**。第一版量法（每次重開一個 Chrome、固定順序）**同一組比較跑兩次會得到相反的結論**。
   兩個雜訊源：①headless Chrome 的第一個網路請求要等 network service 起來（實測 ~570ms）
   → 先拿一個不相干的檔暖機把它燒掉；②**先跑的那個目標有系統性偏差**
   → 單一 Chrome ＋ 交錯 ＋ 每輪隨機打散。**看 p25 不要只看中位**，中位很容易被機器忙碌度帶走。
3. **機器忙的時候數字整組會漂**（跑五個 server 的時候中位從 300ms 漂到 1100ms）。
   要下結論的那一輪，先把其他東西關掉，而且**永遠是同一輪之內互相比**，不要跨輪比。

## `first-frame.mjs`（2026-08-27 v1.6.1 新增）

驗**「第一次繪製那一幀 ＝ 動畫的起始狀態」**——三支樣式表是非阻塞的，所以
第一次繪製是 `index.html` 的關鍵路徑 inline CSS 畫的，`css/splash.css` 幾十毫秒之後才套用、
動畫從頭跑。兩者只要不一致，畫面就會跳一次（Benson 的錄影畫格 89 就是這個）。

```bash
node scripts/probe/first-frame.mjs                 # 正常量測 ＋ 負控組
node scripts/probe/first-frame.mjs --delay=1200    # 把 CSS 的窗口撐得更開
```

- 自己起 server（可延遲 CSS、可改寫 index.html），不用另開行程。
- 逐 rAF 取樣；取樣點用**頁面自己看得到的狀態**判斷（三支 link 的 `media` 都變成 `all`），
  不是用外部時鐘猜。
- **自帶負控組**：把關鍵路徑塊換回 v1.6.0 的完成態再量一次，這把尺必須翻紅
  （實測跳幅 1.000）。容差 0.08 是兩幀的取樣延遲，腳本會斷言負控組的跳幅至少是容差的 10 倍。
- 順便斷言 `#splash` 在第一次繪製那一幀就蓋滿整個 viewport，
  而且 `elementFromPoint(中央, innerHeight-1)` 落在 `#splash` 裡。
- exit 0 過／1 有東西在跳／2 尺壞了（沒取到樣、找不到 Chrome）。

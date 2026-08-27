# 好雷嗎?

看 Netflix 或去電影院之前，**一頁看完一部片值不值得看**。

- 電影院現在上映什麼、你訂的串流平台上有什麼，兩個分頁分開看
- 點進一部片：TMDB／IMDb／爛番茄／Metacritic 四個分數 + 綜合評價 + **PTT 鄉民風向** + 台灣哪裡看得到
- 純靜態網頁、可加到 iPhone 主畫面（PWA）、離線也打得開殼

> **這個 App 只查評價，不導購。** 沒有「去訂票」「去 Netflix 看」的按鈕，平台資訊只顯示、不可點。
> （PTT 文章標題可以點過去看內文——那是「繼續讀評價」，不是導購。）

---

## 怎麼跑（本機）

沒有任何建置步驟、沒有 npm 套件。開一個靜態伺服器指到專案資料夾就好：

```bash
# 擇一
python3 -m http.server 8080
npx serve .
```

然後開 `http://localhost:8080/`。

> ⚠️ **不要用 `file://` 直接開 index.html**：Service Worker 與部分瀏覽器 API 在 file:// 下不會動。

## 金鑰？不用設定了（v1.3.0）

**打開網址就能用。** 沒有登入畫面、沒有設定金鑰那一頁。

金鑰是從[鑰匙圈](https://github.com/xd1104/keyring)自動拿的：`movie-library` 那個 App 在後台被標成
**公開**，所以 TMDB／OMDb 的查詢金鑰是以明文放在鑰匙圈的公開檔裡，任何人打開這個網址都能用。

> 這是刻意的取捨：TMDB／OMDb 是**免費查詢金鑰**，最壞是額度被別人用掉、重新產一組就好。
> （GitHub token 那種有寫入權的東西**永遠不會**這樣放，鑰匙圈後台也會直接擋下來。）

### 如果打開之後說「現在還不能查片」

代表拿不到那組金鑰，畫面上會直接告訴你怎麼辦，並且**當場給你一個手貼金鑰的表單**：

1. 先按「再試一次」（多半是網路）
2. 還是不行 → 到鑰匙圈後台確認「電影評分」那一列有沒有設成**公開**
3. 急著用 → 就在那個畫面自己貼金鑰（**你貼的優先於鑰匙圈的值**，存在這台裝置上）

| | 去哪申請 | 要拿哪一種 |
|---|---|---|
| **TMDB**（必要） | https://www.themoviedb.org/settings/api | **API Key (v3 auth)**，32 碼那組。**不要**拿 `API Read Access Token`（eyJ… 開頭那個長的） |
| **OMDb**（選用） | https://www.omdbapi.com/apikey.aspx | 選 **FREE!（1,000 daily limit）**，信箱會收到 8 碼金鑰；**信裡的啟用連結一定要點** |

手貼過之後，設定頁會多一行「你自己貼的」＋一顆「清掉，改用鑰匙圈的」。

## 怎麼跑測試

```bash
npm install     # 只有一個開發相依（jsdom），上線的 App 還是零依賴
npm test
```

```
  ✓ t1-firstrun     26 過 /  0 失敗    第一次使用／設定金鑰
  ...
  全部通過：共 813 個斷言，813 過 / 0 失敗，13 支測試檔
```

```bash
npm run test:mutate -- --dry   # 幾秒：只檢查每條突變的目標字串還套不套得上
npm run test:mutate            # ⚠ 1.5~2 小時：把程式各弄壞一次，確認測試真的會紅（平常用 --only=）
```

`test:mutate` 是用來證明「測試真的在保護那些事」的（跑完自動還原並用 SHA-256 驗證）。
**重構完先跑 `--dry`**：改了程式碼形狀常常會讓突變的目標字串失效，
失效的突變等於那件事沒人在驗——工具會把它算成失敗，不會裝沒事。

**改東西之前先跑一次 `npm test`，改完再跑一次。**

## 怎麼部署到 GitHub Pages

1. 把整個資料夾 push 到 GitHub repo（例如 `movie-library`）。
2. repo → Settings → Pages → Source 選 **Deploy from a branch**，Branch 選 `main` / `(root)`。
3. 等一分鐘，網址是 `https://<帳號>.github.io/movie-library/`。
4. iPhone 用 Safari 開那個網址 → 分享 → **加入主畫面**。

不需要 GitHub Actions，也不需要建置。repo 裡有 `.nojekyll`，避免 Jekyll 亂處理檔案。

> 專案站在 `/movie-library/` 這種**子路徑**底下，所以所有路徑都是相對的（`./`）。
> 改動時**不要**把任何路徑寫成開頭 `/`，會全部 404。

## 改版之後要做的事

**兩個地方都要 +1**（少改一個，使用者會拿不到新版）：

1. `js/config.js` 的 `HLM_VER` —— Service Worker 的快取名稱綁著它，改了才會把舊快取換掉。
2. `sw.js` 第一行的 `/* build 1.0.0 */` —— 瀏覽器判斷「SW 有沒有更新」是比對 **sw.js 本身的位元組**，
   只改 `importScripts()` 進來的 config.js 有機會不觸發更新。這行就是那道保險。

改完之後，已經打開 App 的人會看到「有新版本了」提示，按下去才會重新載入
（**不會自動重整**——他可能正在貼金鑰）。

## 檔案結構

```
index.html               三個畫面的骨架（片單／詳細／設定）
js/keyring-unlock.js     鑰匙圈解鎖模組（xd1104/keyring 的複製品，⚠️ 不要在這裡改）
package.json             只有測試用的開發相依（jsdom）；App 本身零執行期依賴
test/                    測試（jsdom + 假 API），npm test
css/app.css              全部樣式（深色、單檔）
js/config.js             版本號、API 端點、快取 TTL、平台字典    ← sw.js 也會載入
js/store.js              localStorage：偏好、金鑰、快取（含淘汰）
js/api.js                TMDB / OMDb 呼叫、錯誤分類、資料正規化
js/ui.js                 畫面片段產生器（純字串，不碰狀態）
js/app.js                狀態、路由、事件、啟動自我體檢
sw.js                    Service Worker（殼 cache-first、API 不快取）
manifest.webmanifest     PWA
icons/                   PNG icon（用 scripts/gen-icons.mjs 產的，已 commit）
scripts/gen-icons.mjs    一次性的 icon 產生器（純 Node、零依賴，平常不用跑）
```

## 資料來源

- [TMDB](https://www.themoviedb.org/)：片名、海報、簡介、演職員、台灣觀看平台、TMDB 觀眾評分
- [OMDb](https://www.omdbapi.com/)：IMDb、爛番茄、Metacritic 分數

This product uses the TMDB API but is not endorsed or certified by TMDB.

## PTT 鄉民評價（每天自動抓）

PTT 電影板的文章標題自帶 `[好雷]` / `[普雷]` / `[負雷]`，數標題就能算風向——
**不用 AI、不讀內文**。GitHub Actions 每天抓一次，產出 `data/ptt-movie.json` 存回 repo，
App 直接讀同源的這個檔（純靜態網頁不能自己抓 PTT，跨網域會被擋）。

### 老闆要做的事：設一個 secret（只做一次）

repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| | |
|---|---|
| Name | `TMDB_KEY` |
| Secret | 你的 TMDB **API Key (v3 auth)**，32 碼那組（跟 App 設定頁貼的是同一組） |

爬蟲要用它抓「電影院上映中 ＋ 台灣訂閱串流」的片單，才知道要把 PTT 文章對到哪部片。
**沒設的話 workflow 會直接紅掉並告訴你去哪裡設**，不會安靜產出一份空檔案。

金鑰只存在 GitHub secret 裡：不進 repo、不進紀錄（程式所有輸出都會先把 `api_key=` 遮成 `***`）。

### 怎麼跑

- 自動：每天台灣時間 03:30（`.github/workflows/ptt.yml`）
- 手動：Actions → 「抓 PTT 電影板評價」 → **Run workflow**
- 本機（不連網、用假測資跑完整流程，看得到輸出長相）：

```bash
node scripts/fetch-ptt.mjs --offline --out=/tmp/ptt.json
```

### App 上長怎樣

詳細頁的四個分數下面多一張「PTT 鄉民風向」卡：一句結論詞（幾乎全是好雷／評價兩極／負雷居多…）、
好雷率、好／普／負的比例條與票數，再加 5 則文章標題（點了會用瀏覽器開 PTT）。

- **不會把 PTT 換算成分數**，也不會算進綜合分數環——那是真人一票一票投的，跟評分網站不是同一種東西。
- 少於 4 篇不畫比例條（3 篇算百分比是說謊），只列標題。
- 沒有討論的片只有一行灰字；**讀不到資料**則是另一種畫面（有重試鈕），兩者刻意長得不一樣。
- 資料超過 3 天沒更新會標成琥珀色並說「已經 N 天沒更新」。

### 檔案長相（`data/ptt-movie.json`）

```json
{
  "updated": "2026-08-23T04:00:00Z",
  "source": "https://www.ptt.cc/bbs/movie/index.html",
  "scanned": { "pages": 40, "posts": 797, "tagged": 158, "matched": 104, "ambiguous": 2, "unmatched": 52 },
  "movies": {
    "693134": {
      "good": 12, "ok": 3, "bad": 1,
      "posts": [
        { "tag": "好雷", "title": "[好雷] 沙丘2 視聽饗宴",
          "url": "https://www.ptt.cc/bbs/movie/M.1234567890.A.ABC.html", "date": "8/20", "push": 45 }
      ]
    }
  }
}
```

- key 是 **TMDB 電影 id**；`good`/`ok`/`bad` ＝ 好雷/普雷/負雷（**全部文章的數量**）
- `posts` 依推文數由高到低，**每部片最多 8 則**（檔案會被使用者下載，不能無限長）
- **沒有討論的片不會出現在 `movies` 裡**（App 顯示「PTT 上沒找到討論」）
- `scanned` 是健康度：`pages` 抓了幾頁、`posts` 掃到幾篇（**含非雷文**）、`tagged` 雷文幾篇、
  `matched` 比對到片、`ambiguous` 同名破平也分不出來而放棄、`unmatched` 根本沒命中。
  **`tagged = matched + ambiguous + unmatched`**，比對率＝ `matched ÷ tagged`

### 出事的時候看哪裡

Actions 的紀錄最後有一段「這一輪的結果」，看三個數字就好：
**掃到文章**、**有雷標籤**、**比對到片**。任何一個是 0 就是壞了。

爬蟲會自己判斷「我是不是壞了」並**讓 Actions 紅掉**（抓到 0 篇文章、0 篇帶得到標籤、
片單 0 部、一半以上的頁解析不到東西），同時印出診斷：URL、HTTP 狀態、HTML 前 500 字。
**這是刻意的**——安靜產出一份空 JSON 的話，App 上只會顯示「沒有討論」，沒有人會知道爬蟲已經死了。

要修的地方只有一處：`scripts/ptt-parse.mjs` 最上面的 `SELECTORS`，
PTT 的網頁結構假設全部集中在那裡。

> 做畫面的人：`test/fixtures/sample-ptt-movie.json` 是一份**用假測資產生的範例檔**（格式跟真的一樣，
> 多一個 `_sample` 欄位標明它是假的）。可以先照它做 UI，不用等第一次 Actions 跑完。

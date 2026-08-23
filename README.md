# 好雷嗎?

看 Netflix 或去電影院之前，**一頁看完一部片值不值得看**。

- 電影院現在上映什麼、你訂的串流平台上有什麼，兩個分頁分開看
- 點進一部片：TMDB／IMDb／爛番茄／Metacritic 四個分數 + 綜合評價 + 台灣哪裡看得到
- 純靜態網頁、可加到 iPhone 主畫面（PWA）、離線也打得開殼

> **這個 App 只查評價，不導購。** 沒有「去訂票」「去 Netflix 看」的按鈕，平台資訊只顯示、不可點。

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

## 怎麼設定金鑰（第一次一定要做）

第一次打開會直接進設定頁，照著上面三步做就好。摘要：

| | 去哪申請 | 要拿哪一種 |
|---|---|---|
| **TMDB**（必要） | https://www.themoviedb.org/settings/api | **API Key (v3 auth)**，32 碼那組。**不要**拿 `API Read Access Token`（eyJ… 開頭那個長的） |
| **OMDb**（選用） | https://www.omdbapi.com/apikey.aspx | 選 **FREE!（1,000 daily limit）**，信箱會收到 8 碼金鑰 |

**OMDb 那封信裡有一個啟用連結，一定要點下去**，沒點的話金鑰是死的、貼進來會顯示無效。這是最多人卡住的地方。

貼完按「**儲存並測試連線**」，會分別告訴你 TMDB 與 OMDb 各自通不通。

同一頁往下還有「**我訂了哪些平台**」，勾一次之後「串流」分頁預設就只看那幾個平台。

- 金鑰只存在**你自己這台裝置的 localStorage**，不會上傳、不在程式碼裡、不進 git。
- 換手機／清瀏覽器資料要重貼一次。
- **只填 TMDB 也能用**，差別只是詳細頁少了 IMDb／爛番茄／Metacritic 三個分數。

## 怎麼跑測試

```bash
npm install     # 只有一個開發相依（jsdom），上線的 App 還是零依賴
npm test
```

```
  ✓ t1-firstrun     26 過 /  0 失敗    第一次使用／設定金鑰
  ...
  全部通過：共 327 個斷言，327 過 / 0 失敗，10 支測試檔
```

`npm run test:mutate` 會把程式各弄壞一次，確認測試真的會紅（跑完自動還原並用 SHA-256 驗證）。
**改東西之前先跑一次，改完再跑一次。**

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

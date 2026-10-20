# POC-01 實作與驗證報告

## 目前結論：INCONCLUSIVE（Task 03–05 尚待完整雲端驗收）

Task 01 腳手架與 Task 02 單頁診斷已在 GitHub-hosted runner 通過，兩次 Run 的 artifact 均已實際下載並核對。Task 03、04 已沿用現有程式實作完整分頁與商品輸出，必要離線測試已通過；Task 05 正在補齊完整模式的雲端證據。下方保留先前單頁實測記錄。

| 項目 | 本機驗證 | GitHub-hosted runner |
|---|---|---|
| Task 01 環境檢查 | PASS | PASS，診斷 artifact 已下載核對 |
| Task 02 第一頁 | PASS，HTTP 200，24 筆有效商品 | PASS，HTTP 200，24 筆有效商品 |
| 完整分頁與 JSON | 離線合成資料 PASS；未執行本機完整活動抓取 | 待執行 |
| 完整 Artifact 下載驗證 | 未取得雲端完整檔案 | 待執行 |

## 本機實測記錄

- 最終重跑：2026-10-20 15:01（Asia/Taipei）；2026-10-20T07:01:54.643Z 至 07:01:56.416Z。
- 環境：Windows x64、Node.js v20.18.0；非 GitHub-hosted runner。
- 來源：<https://store.playstation.com/zh-hant-tw/category/10f8c20b-f1b4-4814-ad6a-acb122e4ab04/1>
- API：`https://web.np.playstation.com/api/graphql/v1/op`，`categoryGridRetrieve`，GET。
- 未使用登入憑證、Cookie、Authorization、個人 Token；未跟隨 redirect 或解驗證挑戰。
- 官方活動頁與 2 份公開腳本均 HTTP 200，API HTTP 200；共 4 次請求，未重試。
- 當次 `pageInfo`：`offset=0`、`size=24`、`totalCount=2304`、`isLast=false`。2304 只是當次值。
- 第一頁：原始 24 筆、唯一商品 ID 24 個、重複 0 筆，商品 ID／名稱檢核通過。
- 商品檔：`scope=first-page-only`、`complete=false`；不輸出完整活動商品檔。
- 本機產物：`artifacts/fetch-report.json`、`artifacts/POC_REPORT.md`、`artifacts/first-page-products.json`（忽略追蹤，可重新執行產生）。

程式與流程檢查：

- `npm ci --ignore-scripts --no-audit --no-fund`：依鎖檔安裝成功。
- `npm test`：25 / 25 項離線測試通過，包含目前 hash 格式、網址限制、錯誤回應、重試上限、分頁欄位與商品識別。
- CLI 環境模式：成功，未請求 PS Store；非法網址：exit 1、零請求、留下原因報告並清除舊商品檔。
- Workflow YAML 解析與必要設定檢查通過：僅手動觸發、唯讀權限、hosted runner、逾時、失敗亦上傳 artifact、action commit 固定、輸入透過環境變數傳遞。
- `git diff --check` 通過；診斷產物、下載暫存與 node_modules 均被忽略。
- 以上是本機檢查；GitHub Actions 的執行及 artifact 驗收另列於下方。

## 查詢證據及限制

當次官方頁面載入的查詢來源：

- <https://store.playstation.com/_next/static/chunks/pages/_app-0e534ffc4c46f8fa.js>：價格／媒體 fragment、語系標頭設定、排序 AST 與舊 GraphQL 列印算法。
- <https://store.playstation.com/_next/static/chunks/890-573a913fb57da7e4.js>：`categoryGridRetrieve` 查詢、商品及 pageInfo 欄位。
- 由上述定義計算且經 API 驗證的 hash：`88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03`。

開發時先發現新版 GraphQL 列印格式與官方不同，計算出的 hash 被回覆 HTTP 400 `not whitelisted`；依官方單行參數及結尾換行格式修正後，再補上公開 API 要求的一般 JSON Content-Type 標頭，最終單頁成功。未嘗試替代代理、登入憑證或封鎖繞過。

執行時從當前官方頁面重新提取定義；此記錄與測試 fixture 都不作為失敗 fallback。若官方查詢／打包／hash 算法改動，應停止並人工核對。完整分頁與首尾重驗結果將另列下方；正式公開使用限制尚未驗證。

## GitHub-hosted runner 實測

兩次均為 `workflow_dispatch`，執行程式 commit 為 `18922b4f7d6faabea01c0956df599363a60079ee`，分支 `main`。
Checkout、依賴安裝、25 項離線測試、診斷、Summary 寫入與 artifact 上傳步驟均成功。

| 欄位 | 實測值 |
|---|---|
| Task 01 Run | [39384561665](https://github.com/promise82114/ps-store-sale-poc/actions/runs/39384561665)，success |
| Task 01 artifact | `poc01-environment-39384561665-1`，ID `12246986427`，已下載核對 |
| Task 01 診斷時間 | 2026-10-20T07:08:18.509Z 至 07:08:18.510Z（台北 15:08） |
| Task 01 環境 | Linux x64、Node.js v24.21.0、`githubHostedRunner=true` |
| Task 01 結果 | `environmentCheck=PASS`、零 PS Store 請求；API 未執行，故該份報告的 `conclusion=INCONCLUSIVE` 符合設計 |
| Task 02 Run | [39384708364](https://github.com/promise82114/ps-store-sale-poc/actions/runs/39384708364)，success |
| Task 02 artifact | `poc01-first-page-39384708364-1`，ID `12247120220`，已下載核對 |
| Task 02 診斷時間 | 2026-10-20T07:09:53.743Z 至 07:09:55.635Z（台北 15:09） |
| Task 02 環境 | Linux x64、Node.js v24.22.0、`githubHostedRunner=true` |
| Task 02 API / pageInfo | HTTP 200；`offset=0`、`size=24`、`totalCount=2304`、`isLast=false` |
| Task 02 商品數量 | 原始 24、唯一 ID 24、重複 0；ID 及名稱驗證通過 |
| Task 02 結果 | `firstPageValidation=PASS`、`conclusion=PASS`、`authenticationUsed=false`、`error=null` |
| Task 01 / Task 02 結論 | PASS；尚未取得後續頁面，所有商品產物仍為 `complete=false` |

Task 02 共 4 次請求（官方活動 HTML、2 份公開腳本、GraphQL 第一頁），均為首次 HTTP 200、沒有重試；GraphQL 耗時 581ms。
雲端當次 hash 與上述本機實測相同。已核對下載的報告之 Run URL、hosted runner 標記及認證狀態，並核對商品檔筆數、唯一鍵與 `scope=first-page-only`。
下載副本保存在本機忽略追蹤的 `.local/cloud-environment/`、`.local/cloud-first-page/`；Repo 僅提交此文字記錄，商品資料仍由 artifact 提供，保留 7 天。

重現及 artifact 判讀步驟見 [README](../README.md)。

## Task 03–05：完整模式驗證

### 本機離線測試

- 2026-10-20，Windows x64、Node.js v20.18.0；52 / 52 項測試通過。測試使用合成商品與官方查詢快照，沒有對 PS Store 執行完整活動抓取。
- 保留原 25 項測試，新增動態總數、整除／非整除尾頁、實際 size 推進、缺省 isLast、總數增減、首尾 ID 變動與最多兩輪重抓。
- 驗證重複 ID 的出現次數／唯一數、無進展、錯誤 offset／size、空頁、矛盾 isLast、頁數／時間上限與 HTTP 重試上限。
- 透過離線完整執行驗證 JSON schema、完整成功檔、分離的 partial 檔、舊檔／暫存檔清理、非零失敗、不留敏感資料及既有單頁模式相容性。
- 完整抓取限制：依序、開始間隔至少 750ms、單次逾時 20 秒、網路／5xx／429 最多 3 次、Retry-After 上限 30 秒、每輪最多 500 頁、最多 2 輪、共用抓取預算 8 分鐘、job 15 分鐘。
- 總數／首尾商品變動時最多重抓一次且捨棄前輪資料；其他結構或存取錯誤停止。完整商品數、唯一數及總數一致並通過首尾重驗後，才以暫存檔更名產生 `sale-products.json`。

### 商品網址來源驗證（本機公開頁面）

2026-10-20T07:16:13.448432Z，以未登入 HTTP GET 取得下列官方商品頁，HTTP 200、最終 URL 相同；頁面 `__NEXT_DATA__` 的 `pageProps.productId` 與商品 ID 相符、`statusCode=200`、`isLoggedIn=false`，路由為 `/[locale]/product/[productId]`：

[官方商品頁](https://store.playstation.com/zh-hant-tw/product/JP9000-PPSA15595_00-MTFSUE0000000000)

因此完整輸出可對符合安全 Product ID 字元格式的商品使用此已驗證路徑規則，標示 `urlSource=verified-product-route`。這不是逐筆商品頁可用性驗證；未新增逐筆請求。

### GitHub-hosted runner 完整抓取

待執行 `mode=full`，下載 artifact 後記錄 Run、commit、時間、各頁狀態、商品原始／唯一／重複數、耗時、錯誤、首尾重驗及完整 JSON 下載檢核結果。

完整模式通過前，整體結論維持 INCONCLUSIVE。此 POC 不提交正式公開商品 JSON，也不開始 POC-02、POC-03 或正式網站。

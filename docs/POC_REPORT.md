# POC-01 Task 01 / Task 02 實作與驗證狀態

## 目前結論：PASS（僅 Task 01 / Task 02）

Task 01 腳手架與 Task 02 單頁診斷已在 GitHub-hosted runner 通過，兩次 Run 的 artifact 均已實際下載並核對。此結果只證明環境流程及未登入取得第一頁商品；完整分頁與 Task 03–05 未開始。

| 項目 | 本機驗證 | GitHub-hosted runner |
|---|---|---|
| Task 01 環境檢查 | PASS | PASS，診斷 artifact 已下載核對 |
| Task 02 第一頁 | PASS，HTTP 200，24 筆有效商品 | PASS，HTTP 200，24 筆有效商品 |
| 完整分頁 | 未執行，不在此次範圍 | 未執行 |

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

執行時從當前官方頁面重新提取定義；此記錄與測試 fixture 都不作為失敗 fallback。若官方查詢／打包／hash 算法改動，應停止並人工核對。尚未驗證完整分頁、抓取期間總數穩定性或正式公開使用限制。

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

# POC-01 實作與驗證報告

## 最終結論：PASS（POC-01 Task 01–05）

沿用現有專案及 Task 01、02 已驗證的公開查詢，Task 03–05 已完成完整分頁、JSON 輸出與雲端實測報告。先在本機完成 52 項離線測試，再由 GitHub-hosted runner 未登入取得全部活動商品，完整 JSON 已實際從 Actions artifact 下載並核對。下方保留先前單頁實測記錄，完整模式證據另列於後。

| 項目 | 本機驗證 | GitHub-hosted runner |
|---|---|---|
| Task 01 環境檢查 | PASS | PASS，診斷 artifact 已下載核對 |
| Task 02 第一頁 | PASS，HTTP 200，24 筆有效商品 | PASS，HTTP 200，24 筆有效商品 |
| 完整分頁與 JSON | 52 項離線測試 PASS；未執行本機完整活動抓取 | PASS，96 頁，唯一商品 2304 筆 |
| 完整 Artifact 下載驗證 | 已下載雲端 artifact 並獨立核對 JSON | PASS，完整 JSON 及診斷報告可下載 |

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

| 項目 | 實測結果 |
|---|---|
| Run | [39386581449](https://github.com/promise82114/ps-store-sale-poc/actions/runs/39386581449)，`workflow_dispatch`、`mode=full`、success |
| 程式 commit | `3e7dafc41380579e213c00a6018034b9fd151de5`，`main` |
| Runner | GitHub-hosted Linux x64，Node.js v24.21.0 |
| 執行時間 | 2026-10-20T07:27:11.069Z 至 07:28:26.288Z（Asia/Taipei 15:27:11 至 15:28:26） |
| 耗時 | 整體診斷 75,219ms；分頁及首尾重驗 73,637ms |
| 來源與查詢 | 上述台灣活動 URL；`categoryGridRetrieve`，當次重新提取官方定義並計算 hash |
| 當次 hash | `88c0b9a1273c6d320c51cd73e390924e21ae28bf09f01cde8b84b1034b16cd03` |
| 活動頁數 | 96 頁；offset 由 0 推進至 2280，當次各頁 size=24 |
| 當次 totalCount | 2304，各頁及首尾重驗一致；不是硬編碼驗收常數 |
| 結束資訊 | 首頁 `isLast=false`；末頁 `offset=2280`、`size=24`、`isLast=true`、回傳 24 筆 |
| 原始／唯一／重複 | 2304／2304／0，重複 ID 數 0 |
| 輪次與首尾重驗 | 1 輪 accepted；另重驗 offset 0、2280，HTTP 200、總數及商品 ID 順序相同，boundaryVerification=PASS |
| HTTP 請求 | 101 次：活動 HTML 1、官方公開腳本 2、商品分頁 96、首尾重驗 2；全部 HTTP 200 |
| 重試／錯誤 | retryCount=0、error=null；沒有捨棄輪次或失敗頁面 |
| 認證 | authenticationUsed=false；不送 PSN Cookie、Authorization、帳密或私人 Token |
| 結論 | fullValidation=PASS、conclusion=PASS、complete=true |

雲端的安裝、52 項離線測試、完整診斷、Summary 寫入及 artifact 上傳步驟均成功。
完整抓取只執行了此 GitHub-hosted Run；本機只做離線測試、商品網址規則探測，以及下載結果的獨立檢核。

### 完整 Artifact 與 JSON 下載驗證

- Artifact：[poc01-full-39386581449-1](https://github.com/promise82114/ps-store-sale-poc/actions/runs/39386581449/artifacts/12247218682)，ID `12247218682`，上傳封裝大小 967,529 bytes，保留 7 天。
- 已實際下載並解析 `bootstrap.json`、`fetch-report.json`、`POC_REPORT.md`、`sale-products.json`。未出現 `partial-products.json`。
- 完整商品 JSON 大小 7,046,941 bytes；SHA-256：`062bda52b252d5a3a6629ba22b1345faef4a079bf0d18be298c21d449c659dfd`。
- 已核對 `schemaVersion=1`、saleId、`locale=zh-hant-tw`、fetchedAt、`scope=full-activity`、`complete=true`、totalCount、reportedTotalCount 及 products。
- 獨立計算 JSON products 長度及 Product ID 唯一數，均為 2304，與 report 原始／唯一筆數一致；每筆 ID／名稱非空，`key=locale:id`。
- 另逐頁核對 96 頁 offset 連續性、size、當次 totalCount、回傳筆數、isLast 與 HTTP 200；覆蓋商品筆數合計 2304，兩份首尾重驗紀錄均通過。
- 2304 筆都有商品 URL、價格物件及圖片 URL。價格物件內 basePrice、discountedPrice 均有值；2281 筆 discountText 有值，23 筆為 API 原值 null，沒有捏造折扣。
- 商品 URL 全部標示 `urlSource=verified-product-route`；圖片及價格來自當次 API。未逐筆另發商品頁請求。
- 已檢查商品及報告未含 Cookie、Authorization、password、access_token、refresh_token 或 PSN Token 等憑證欄位；認證狀態為 false。
- 本機下載副本位於 `.local/cloud-full/`，被 `.gitignore` 排除；Repo 只提交程式、測試與文字報告，沒有提交活動商品 JSON。

### 驗收對照

| 條件 | 結果與證據 |
|---|---|
| AC-01 GitHub-hosted runner | PASS，完整模式 Run 及報告標示 githubHostedRunner=true |
| AC-02 無登入 | PASS，公開請求固定標頭、credentials=omit，報告 authenticationUsed=false，產物無憑證欄位 |
| AC-03 首頁資料 | PASS，Task 02 及完整模式均有有效商品 ID、名稱與 pageInfo |
| AC-04 分頁完整性 | PASS，96 頁連續覆蓋、原始與唯一數等於當次總數、末頁 isLast=true、首尾重驗通過 |
| AC-05 商品識別 | PASS，2304 個 Product ID 唯一；離線測試確認同名及同 npTitleId 不合併不同商品 ID |
| AC-06 去重報告 | PASS，原始 2304、唯一 2304、重複 0；離線重複案例有筆數及出現次數紀錄 |
| AC-07 JSON 輸出 | PASS，完整 JSON 可解析且 schemaVersion=1，必要欄位通過，缺少折扣保留 null |
| AC-08 失敗保護 | PASS（離線測試）；驗證分頁／重驗／HTTP 失敗均非零、清除舊完整檔並分離 partial；未對正式服務刻意製造雲端 403 或失敗 |
| AC-09 安全與權限 | PASS，僅手動觸發、contents:read、無 PSN Secrets、不由 runner commit 商品 JSON 或部署 Pages |
| AC-10 可重現性 | PASS，README 已列 full 模式與下載步驟；此 Run 的 artifact 已實際下載核對 |

### 結論與實測界線

**PASS**：本次指定台灣活動已由未登入的 GitHub-hosted runner 取得完整且可驗證的商品清單，滿足 POC-01 的問題與 Task 03–05 驗收。

此結果限於本活動、本次服務狀態及上述程式版本；官方 hash／腳本打包或存取政策改變時仍須重新驗證，程式會在無法使用查詢或遭拒時停止。
總數、唯一 ID、分頁覆蓋與首尾重驗提供一致性證據，但 API 未提供固定時間點快照，不能保證抓取期間中間頁的所有欄位完全沒有變動。
Artifact 是保留 7 天的測試產物，不是正式持久資料或公開發佈。正式公開使用條件未在本 POC 評估。

本次工作到 POC-01 結束；未啟動 POC-02、POC-03、正式網站、IndexedDB 或個人分類功能。

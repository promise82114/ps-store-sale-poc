# PS Store POC-01 — 公開活動商品擷取驗證

獨立測試 Repo，驗證 **GitHub-hosted runner 能否不登入 PSN，取得指定台灣活動的全部商品**。
沿用 Task 01、02 已通過的查詢，提供環境檢查、單頁診斷與完整活動抓取。產物僅供 POC Artifact 驗證。

來源：<https://store.playstation.com/zh-hant-tw/category/10f8c20b-f1b4-4814-ad6a-acb122e4ab04/1>

## 手動執行 GitHub Actions

1. 將本 POC 檔案提交並 Push 到此 Repo 的預設分支；`workflow_dispatch` 工作流程需要先存在於預設分支。
2. 開啟 Repo 的 **Actions → POC 01 - PS Store diagnostic → Run workflow**。
3. 先選 `mode=environment`，確認環境檢查、離線測試與診斷 artifact 成功。
4. 再選 `mode=first-page`，保留預設 `sale_url`，執行第一頁 API 診斷。
5. 選 `mode=full` 執行完整抓取；此模式也會先執行全部離線測試，測試失敗時不發出 PS Store 請求。
6. 進入該次 Run，查看 Summary，從 **Artifacts** 下載 `poc01-<mode>-<run ID>-<attempt>`。保留 7 天，並非正式資料儲存。
7. 檢查 `fetch-report.json`、`POC_REPORT.md`。完整成功時有 `sale-products.json`；失敗時無該檔，若已有有效商品則另外提供 `partial-products.json`。

只允許上述活動、`zh-hant-tw`、第 1 頁的完整 HTTPS URL；其他主機、語系、活動、頁碼、port、query、fragment、帳密或編碼變體一律拒絕，且不發出網路請求。
`environment` 模式不請求 PS Store；`first-page` 模式只驗證 offset=0、size=24；`full` 才會取得其餘頁面。

## 本機重現

使用 Node.js 20.18+（Actions 使用 Node.js 24）：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run diagnose
npm run fetch:full
```

每次執行都覆寫 `artifacts/fetch-report.json` 與 `artifacts/POC_REPORT.md`，並先清除舊的第一頁、完整、部分商品檔及其暫存檔。
商品 JSON 先寫暫存檔，再更名；完整驗證未通過時不會寫入 `sale-products.json`。
`npm test` 完全離線，使用合成資料與公開查詢快照，不會連線 PS Store。
輸入網址也可透過 `--sale-url` 或 `SALE_URL` 設定；僅供測試白名單拒絕行為，並非任意網址抓取工具。

## 查詢取得與停止條件

- 從當次官方活動 HTML 的同源 Next.js 腳本提取查詢與兩個 fragment；最多讀取 12 個候選腳本，**只解析字串，不執行遠端 JavaScript**。
- 依已核對的官方客戶端算法加入 `__typename`、排序 AST，再用官方舊列印格式計算 persisted query hash；不硬編碼歷史 hash，不使用第三方 hash 當 fallback。
- 只對固定官方 GraphQL 端點發出公開 GET，送 `Accept`、一般 JSON `Content-Type`、`X-PSN-Store-Locale-Override` 與工具名稱 User-Agent；不使用 Cookie、Authorization、PSN 帳密或私人 Token。
- 不跟隨 redirect、不執行驗證腳本、不繞過認證或封鎖。403、認證／驗證挑戰、無法提取或不在白名單的查詢、結構錯誤都直接停止。
- 請求依序執行，開始時間間隔至少 750ms、每次 20 秒逾時、回應最多 8 MiB。暫時性網路失敗與 5xx 最多 3 次（1、2 秒退避）；429 最多 3 次，尊重數字或 HTTP-date 的 `Retry-After`，超過 30 秒或無法解析則停止，無該標頭時等 1 秒。
- 驗證 `categoryGridRetrieve.id`、`products[].id/name`、`pageInfo.totalCount/offset/size/isLast`（如有）；依實際回傳的 size 推進 offset。回傳筆數須等於當頁應有筆數，不能只因尾頁較短就宣稱完成。
- 完整模式每輪最多 500 頁、共用 8 分鐘抓取預算。覆蓋範圍、原始筆數、唯一商品數均須與當次 API 總數相符；檢查重複 offset、空頁、無新商品、無效 size 及矛盾的 isLast。
- 抓完後重驗首尾頁的總數及商品 ID 順序。總數或首尾商品改變時，最多從 offset=0 重抓一輪（合計 2 輪），不同輪資料不混用。仍不一致則非零結束。
- 以 `locale:id` 識別並去重；名稱／npTitleId 相同也保留不同商品 ID。記錄原始筆數、唯一數、重複筆數、重複 ID 數及出現次數；重複導致唯一數不足時停止，不能用去重掩蓋漏抓。
- 完整商品包含 `id/name/url/urlSource/price/imageUrl/media/platforms`。價格及折扣保留 API 原值，缺少非必要資料則 null。`imageUrl` 優先選 API 的 MASTER 圖片，否則選第一張 IMAGE，並保留原始媒體欄位。
- 完整模式使用已實測 HTTP 200 且頁面 Product ID 相符的官方 `/zh-hant-tw/product/{id}` 路徑，僅對安全字元組成的 Product ID 產生 URL，註明 `urlSource=verified-product-route`；此為路徑規則驗證，沒有逐筆另發商品頁請求。API 本身若提供 URL 則優先保留。

## 產出及判讀

| 檔案 | 用途 |
|---|---|
| `bootstrap.json` | Actions 在安裝依賴前寫入的基本環境資訊；不代表任務通過 |
| `fetch-report.json` | 執行環境、官方查詢來源／hash、各請求狀態／耗時、數量與失敗分類 |
| `POC_REPORT.md` | 人工閱讀的當次診斷摘要，亦顯示於 Actions Summary |
| `first-page-products.json` | 僅在單頁驗證通過時寫出；固定 `scope=first-page-only`、`complete=false` |
| `sale-products.json` | 完整抓取及首尾重驗通過時寫出；`scope=full-activity`、`complete=true` |
| `partial-products.json` | 完整模式失敗且已有商品時寫出；`scope=partial`、`complete=false`，不能作為完整活動資料 |

完整商品檔包含 `schemaVersion`、`saleId`、`locale`、`sourceUrl`、`fetchedAt`、`totalCount`、`reportedTotalCount`、原始／唯一／重複計數及 `products`。
報告保存每輪及每頁的預期／實際 offset、size、totalCount、isLast、筆數、HTTP 狀態、耗時與錯誤分類，另記錄請求嘗試及重試次數。
頂層商品計數對應最後一輪有效覆蓋資料；被捨棄輪次保留在 `sweeps`，首尾重驗與 HTTP 重試不重複計入商品筆數。

- **Task 01**：`environmentCheck=PASS`，且 Actions 上有成功的 `environment` Run 與可下載 artifact。
- **Task 02**：GitHub-hosted runner 上 `firstPageValidation=PASS`、`conclusion=PASS`，且有有效第一頁商品與分頁資訊。
- **Task 03–05**：GitHub-hosted runner 上 `fullValidation=PASS`、`conclusion=PASS`、`complete=true`，完整 JSON 已從 artifact 下載並核對筆數、唯一 ID 與必要欄位，再更新報告。
- 本機即使資料驗證通過，`conclusion` 仍為 **INCONCLUSIVE**；`environment` 模式的結論也維持 INCONCLUSIVE，因為未驗證 API。
- 所有診斷失敗均非零結束（包括 INCONCLUSIVE 的暫時錯誤）；workflow 不吞掉失敗。403、認證或查詢失效時，不繼續 Task 03。
- `first-page` 的 PASS 僅涵蓋單頁；`full` 的 PASS 才涵蓋完整活動。總數及首尾重驗是本 POC 的一致性檢查；API 未提供固定時間點快照，不能證明期間所有欄位完全沒有變動。

主要錯誤分類：`INVALID_SALE_URL`、`QUERY_UNAVAILABLE`、`AUTH_REQUIRED`、`ACCESS_DENIED`、`ACCESS_CHALLENGE`、`CSRF_HEADER_REQUIRED`、`RATE_LIMITED`、`NETWORK_ERROR`、`TIMEOUT`、`UPSTREAM_ERROR`、`REDIRECT_REJECTED`、`NON_JSON_RESPONSE`、`INVALID_JSON`、`GRAPHQL_ERROR`、`SCHEMA_MISMATCH`、`INVALID_PAGE_INFO`、`INCONSISTENT_FIRST_PAGE`、`INVALID_PRODUCT`、`EMPTY_CATEGORY`。報告不保存原始錯誤本文或完整標頭。

完整分頁另有 `INCONSISTENT_PAGE`、`TOTAL_COUNT_CHANGED`、`BOUNDARY_CHANGED`、`DUPLICATE_PRODUCT_ID`、`NO_PROGRESS`、`REPEATED_OFFSET`、`UNIQUE_COUNT_MISMATCH`、`MAX_PAGES_EXCEEDED`、`RUN_BUDGET_EXCEEDED`；總數／首尾變動及暫時性失敗歸類 INCONCLUSIVE，其餘資料或存取錯誤歸類 FAIL。兩者均非零結束，不產生完整商品檔。

## 權限與範圍

Workflow 僅 `workflow_dispatch`、`contents: read`，使用 GitHub-hosted `ubuntu-latest`、15 分鐘 job timeout、全 Repo 共用 concurrency，且 checkout 不保留憑證。
不設定排程、push 觸發、Repo secrets、PAT、寫入權限、JSON commit、Pages 部署或正式專案操作。Actions 固定到已核對的官方 action commit。
報告與本機下載的診斷資料均被 `.gitignore` 排除。

POC 僅測試 Artifact，不進入 POC-02、POC-03 或正式網站。實際 Run 連結、數量與 artifact 驗證結果見 [docs/POC_REPORT.md](docs/POC_REPORT.md)。

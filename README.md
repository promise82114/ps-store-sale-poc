# PS Store POC-01 — Task 01 / Task 02

獨立測試 Repo，驗證 **GitHub-hosted runner 能否不登入 PSN，取得指定台灣活動的第一頁商品**。
目前僅實作環境檢查與單頁診斷；不包含完整分頁、正式商品 JSON、前端或部署。

來源：<https://store.playstation.com/zh-hant-tw/category/10f8c20b-f1b4-4814-ad6a-acb122e4ab04/1>

## 手動執行 GitHub Actions

1. 將本 POC 檔案提交並 Push 到此 Repo 的預設分支；`workflow_dispatch` 工作流程需要先存在於預設分支。
2. 開啟 Repo 的 **Actions → POC 01 - PS Store diagnostic → Run workflow**。
3. 先選 `mode=environment`，確認環境檢查、離線測試與診斷 artifact 成功。
4. 再選 `mode=first-page`，保留預設 `sale_url`，執行第一頁 API 診斷。
5. 進入該次 Run，查看 Summary，從 **Artifacts** 下載 `poc01-<mode>-<run ID>-<attempt>`。保留 7 天，並非正式資料儲存。
6. 檢查 `fetch-report.json`、`POC_REPORT.md`；Task 02 通過時另有 `first-page-products.json`。

只允許上述活動、`zh-hant-tw`、第 1 頁的完整 HTTPS URL；其他主機、語系、活動、頁碼、port、query、fragment、帳密或編碼變體一律拒絕，且不發出網路請求。
`environment` 模式不請求 PS Store；`first-page` 模式只驗證 offset=0、size=24，沒有完整抓取選項。

## 本機重現

使用 Node.js 20.18+（Actions 使用 Node.js 24）：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run diagnose
```

每次執行都覆寫 `artifacts/fetch-report.json` 與 `artifacts/POC_REPORT.md`，並先清除上次的第一頁商品檔，避免失敗後留下舊成功資料。
`npm test` 完全離線，使用合成資料與公開查詢快照，不會連線 PS Store。
輸入網址也可透過 `--sale-url` 或 `SALE_URL` 設定；僅供測試白名單拒絕行為，並非任意網址抓取工具。

## 查詢取得與停止條件

- 從當次官方活動 HTML 的同源 Next.js 腳本提取查詢與兩個 fragment；最多讀取 12 個候選腳本，**只解析字串，不執行遠端 JavaScript**。
- 依已核對的官方客戶端算法加入 `__typename`、排序 AST，再用官方舊列印格式計算 persisted query hash；不硬編碼歷史 hash，不使用第三方 hash 當 fallback。
- 只對固定官方 GraphQL 端點發出公開 GET，送 `Accept`、一般 JSON `Content-Type`、`X-PSN-Store-Locale-Override` 與工具名稱 User-Agent；不使用 Cookie、Authorization、PSN 帳密或私人 Token。
- 不跟隨 redirect、不執行驗證腳本、不繞過認證或封鎖。403、認證／驗證挑戰、無法提取或不在白名單的查詢、結構錯誤都直接停止。
- 請求依序執行，開始時間間隔至少 350ms、每次 20 秒逾時、回應最多 8 MiB。暫時性網路失敗與 5xx 最多 3 次（1、2 秒退避）；429 最多 3 次，尊重數字或 HTTP-date 的 `Retry-After`，超過 30 秒或無法解析則停止，無該標頭時等 1 秒。
- 驗證 `categoryGridRetrieve.id`、`products[].id/name`、`pageInfo.totalCount/offset/size/isLast`（如有）；當次總數只供比對，不硬編碼 2304。
- 以 `locale:id` 識別商品，名稱相同也保留不同商品 ID；報告原始／唯一／重複筆數。未提供的價格、平台、URL 等欄位保留 null，不組合未確認的商品 URL。

## 產出及判讀

| 檔案 | 用途 |
|---|---|
| `bootstrap.json` | Actions 在安裝依賴前寫入的基本環境資訊；不代表任務通過 |
| `fetch-report.json` | 執行環境、官方查詢來源／hash、各請求狀態／耗時、數量與失敗分類 |
| `POC_REPORT.md` | 人工閱讀的當次診斷摘要，亦顯示於 Actions Summary |
| `first-page-products.json` | 僅在單頁驗證通過時寫出；固定 `scope=first-page-only`、`complete=false` |

- **Task 01**：`environmentCheck=PASS`，且 Actions 上有成功的 `environment` Run 與可下載 artifact。
- **Task 02**：GitHub-hosted runner 上 `firstPageValidation=PASS`、`conclusion=PASS`，且有有效第一頁商品與分頁資訊。
- 本機即使單頁通過，`conclusion` 仍為 **INCONCLUSIVE**；`environment` 模式的結論也維持 INCONCLUSIVE，因為未驗證 API。
- 所有診斷失敗均非零結束（包括 INCONCLUSIVE 的暫時錯誤）；workflow 不吞掉失敗。403、認證或查詢失效時，不繼續 Task 03。
- `PASS` 僅限 Task 02 單頁驗證，**不代表完整活動、AC-04、Task 03–05 或正式架構通過**。

主要錯誤分類：`INVALID_SALE_URL`、`QUERY_UNAVAILABLE`、`AUTH_REQUIRED`、`ACCESS_DENIED`、`ACCESS_CHALLENGE`、`CSRF_HEADER_REQUIRED`、`RATE_LIMITED`、`NETWORK_ERROR`、`TIMEOUT`、`UPSTREAM_ERROR`、`REDIRECT_REJECTED`、`NON_JSON_RESPONSE`、`INVALID_JSON`、`GRAPHQL_ERROR`、`SCHEMA_MISMATCH`、`INVALID_PAGE_INFO`、`INCONSISTENT_FIRST_PAGE`、`INVALID_PRODUCT`、`EMPTY_CATEGORY`。報告不保存原始錯誤本文或完整標頭。

## 權限與範圍

Workflow 僅 `workflow_dispatch`、`contents: read`，使用 GitHub-hosted `ubuntu-latest`、15 分鐘 job timeout、全 Repo 共用 concurrency，且 checkout 不保留憑證。
不設定排程、push 觸發、Repo secrets、PAT、寫入權限、JSON commit、Pages 部署或正式專案操作。Actions 固定到已核對的官方 action commit。
報告與本機下載的診斷資料均被 `.gitignore` 排除。

Task 01、Task 02 已於 GitHub-hosted runner 通過，Run 連結與 artifact 驗證結果見 [docs/POC_REPORT.md](docs/POC_REPORT.md)。

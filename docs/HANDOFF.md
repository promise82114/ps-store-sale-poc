# PS Store POC 換機交接

更新日期：2026-10-23（Asia/Taipei）。Repository：<https://github.com/promise82114/ps-store-sale-poc>，分支 `main`。

本文件隨 POC-04 程式、測試及報告一併提交。交接版本請以新電腦 `git log -1 --oneline` 顯示的 commit 為準；本次整理前的基準是 `55b713d0ef43bdf0132435e19bd850a0d8441ee2`。不需要複製舊電腦的絕對路徑或 node_modules。

## 1. 目前做到哪裡

| 範圍 | 狀態 | 證據與界線 |
|---|---|---|
| POC-01 Task 01～05 | PASS，歷史實測 | GitHub-hosted runner 完整分頁及 Artifact 下載已驗證；見 POC_REPORT。2304 是當時筆數，不是固定設定 |
| Google Drive 重用分析 | 已完成 | 已比較 EDF Checklist 與 PS Game Base，來源 commit／函式與限制見分析報告 |
| P04-01、P04-02 | PASS | 純個人資料格式、三方合併、Tombstone 與 JSON 備份；原有 62 項測試保留 |
| P04-03 | PASS，本機離線 | 原生 IndexedDB、原子交易、Outbox、持久 Base、上傳期間修改保護；含兩個真實分頁與 reload |
| P04-04 | PASS，Mock 範圍 | ETag／If-Match、412、其他錯誤、建立競態及讀回恢復；沒有真實 Google 呼叫 |
| P04-05～07 | 未開始 | 真實 OAuth／帳號隔離、真實條件寫入、完整故障恢復仍未驗收，整體同步可用性 INCONCLUSIVE |

本 Repo 是 POC，不是正式 `ps-store-sale-filter` 網站。沒有正式商品清單 UI、正式個人資料匯入 UI、排程同步或 Google 登入。

## 2. 換機後先讀

1. [POC04_REPORT.md](POC04_REPORT.md)：第 8～12 節為 P04-03／04，第 13 節是本次提交前回歸；第 1～7 節為第一階段歷史。
2. [GOOGLE_DRIVE_REUSE_ANALYSIS.md](GOOGLE_DRIVE_REUSE_ANALYSIS.md)：原始需求、來源模組、資料格式與後續任務門檻。
3. [POC_REPORT.md](POC_REPORT.md)：POC-01 的歷史 runner／商品 JSON 證據。
4. [README.md](../README.md)、[package.json](../package.json)：執行入口與 Node 規格。

若新電腦有額外的全域／Repository `AGENTS.md`，開始修改前先依其範圍閱讀；不要把舊電腦未追蹤的個人設定當成已隨 Git 移轉。

## 3. 新電腦還原與 Node 測試

需要 Git、npm、符合 `package.json` 的 Node.js（`>=20.18`）。舊電腦實測為 Node v20.18.0、npm 10.8.2；目前 POC-01 Actions 設定使用 Node 24，這不是本階段雲端測試證據。

在新電腦選定的工作目錄執行，不必沿用 `D:\gitp`：

```powershell
git clone --branch main https://github.com/promise82114/ps-store-sale-poc.git
Set-Location .\ps-store-sale-poc
git status --short --branch
git log -1 --oneline
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run test:poc04
npm test
```

依鎖檔安裝依賴需網路；安裝後兩個測試命令均離線、不抓取 PS Store 或 Google。期望為 POC-04 **108/108**，全 Repo **160/160**，exitCode=0、失敗／跳過均為 0。若環境不同，保留實際版本與結果，不把舊測試數直接當新電腦已通過。

不要以 `npm run diagnose` 或 `npm run fetch:full` 檢查一般安裝；這兩個命令會請求 PS Store，本次換機不需執行。`npm test` 已限定 `tests` 目錄，避免舊 `.local` 審查快照被誤計入。

## 4. 原生 IndexedDB 瀏覽器重跑

Node 測試不包含原生 IndexedDB 或真實分頁。另在終端執行：

```powershell
npm run test:poc04:browser
```

伺服器只監聽 `127.0.0.1:4184`。使用同一瀏覽器的兩個獨立分頁，選一個新的 run 字串（英數、底線、連字號，最多 60 字元），例如 `handoff20261023a`：

1. 先開 <http://127.0.0.1:4184/tests/browser/poc04.html?run=handoff20261023a&mode=peer>，看到 peer ready。
2. 再開 <http://127.0.0.1:4184/tests/browser/poc04.html?run=handoff20261023a>，等待 initial **25/25 PASS**。
3. 真正重新整理第二頁，確認 reload **1/1 PASS**，合計 **26/26**。測試期間保留第一頁，避免跨分頁呼叫逾時。
4. 結束後關閉測試頁，在終端 Ctrl+C 停止伺服器。完整重跑請換新 run；同一 run 已保存 reload 狀態時，只會執行 reload 驗證。

使用同一個 `127.0.0.1:4184` origin；不要中途換成 localhost 或其他 port，否則 IndexedDB 不共用。結果寫入 `artifacts/poc04/phase2/` 的 `browser-initial.json`、`browser-reload.json`、`reload-expected.json`；相同檔名會覆寫，若需保留舊證據先在 Git 之外另存。

測試只用合成資料及 `poc04-test-<run>-...` 資料庫，不需 Google 帳號、OAuth Client 或 Cloud 專案。原生瀏覽器引擎／版本不同時仍須實測；不能以 Node 的 PASS 取代。

## 5. 程式位置與不可改變的規則

| 檔案 | 責任 |
|---|---|
| `src/poc04/personal-data.mjs` | schema 驗證、locale:ProductID、分類操作、個人 JSON 匯出／匯入解析 |
| `src/poc04/merge.mjs` | `planMerge`／`resolveMerge`，首同步及日常 Base/Local/Remote 比較、衝突選擇 |
| `src/poc04/sync-state.mjs` | 聚合狀態、localRevision、Outbox、同步 journal、確認與 rebase |
| `src/poc04/indexeddb-store.mjs` | `openPersonalStore`，短交易、交易 complete 才回報成功 |
| `src/poc04/drive-transport.mjs` | 強制注入 request；v2 metadata ETag、If-Match、唯一性與寫後完整核對 |
| `src/poc04/sync-session.mjs` | `prepareSync`／`uploadPrepared`／`recoverSync` |
| `tests/poc04-*.test.mjs` | 108 項 Node 測試 |
| `tests/browser/`、`tests/fixtures/` | 合成資料、Mock backend、原生 IDB 跨分頁／reload 測試 |
| `tools/poc04-browser-server.mjs` | 限定路徑的 loopback 測試伺服器，不是正式產品 |

已確認的合併／資料安全規則：

- 只用追蹤、忽略、未分類；未分類不存一般 mark。取消既有標記要保留 Tombstone，不做 TTL 回收。
- 精確使用 `locale:ProductID`；不按名稱／遊戲家族跨版本繼承，不保存公共商品價格、圖片或遊玩／購買狀態。
- Tombstone 與 mark 相遇一律列衝突；Base 已清除、雙端卻都帶回舊 mark 也不能自動復活。明確人工選擇可恢復標記。
- 相同分類的不同 changeId 固定取字典序較小的完整紀錄；updatedAt 不決定勝負。Base 有紀錄但某端無 mark／Tombstone 時拒絕輸入。
- 同步捕捉 B/L0/r0/S0；Base 只保存被確認的 M。確認時保留後來新增的本機修改，只清除 changeId 與操作 localRevision 都仍吻合 S0 的操作。
- `sending` 必須先持久保存再呼叫 transport；未知結果不刪 journal、不清 Base／Outbox、不盲目重送。只能在完整 readback 吻合候選後確認。
- 缺強 ETag 不覆寫；412 不降級；同名多檔停寫、不任選、不刪檔。首次建立後檢查不代表按檔名的分散式原子唯一建立。

## 6. 哪些內容會／不會隨 Git 移轉

| 內容 | 換機方式 |
|---|---|
| POC 程式、測試、README、三份分析／驗證報告與本交接文件 | 隨本次 commit／push，clone 即可取得 |
| `node_modules/` | 不提交；使用鎖檔重裝 |
| `artifacts/` | 不提交；可重跑產生。若需要保留舊電腦原始 TAP／JSON／截圖，另行複製到自己的移轉媒體或私人備份 |
| `.local/` | 不提交；包含先前來源 Repo 的唯讀快照與臨時探測，不是執行依賴，新電腦不必還原 |
| 瀏覽器 IndexedDB／profile | 不在 Git。現有驗證僅合成資料，可用新 run 重建；無正式個人資料移轉工具 |
| OAuth／PSN／Git 憑證、Cookie、Token | 不提交、不放入交接文件；新電腦的 Git 授權自行使用正常登入方式，P04-01～04 不需 Google／PSN 憑證 |

舊電腦可另外保存的測試證據：`artifacts/poc04/phase2/`（10/20 原生瀏覽器與 Node 結果）及 `artifacts/poc04/handoff-2026-10-23/`（本次提交前 Node 回歸）。本次只準備交接說明，不自動複製至其他雲端或裝置。

若自行用 POC 寫入過需要保留的個人資料，先保留原瀏覽器環境。`exportBackup(document)` 只含個人 envelope，**不含**同步 Base／Outbox／attempt；不能把它當成整套同步狀態的移轉備份。完整狀態的匯出／匯入 UI 尚未實作，不要為換機直接刪除未知結果的 journal。

POC-01 Actions Artifact 有保留期限；舊報告記錄的是當時已下載核對，不保證現在仍可下載。需要原始抓取 JSON 時，先自行保存已有的本機下載，或另行授權重新執行，不在本次啟動抓取。

## 7. 最新驗證與接續工作的停止點

2026-10-23 換機提交前，本機 Node v20.18.0／npm 10.8.2 再次驗證：

- `npm run test:poc04`：108/108 PASS。
- `npm test`：160/160 PASS。
- 失敗、跳過、cancelled、todo 均為 0；來源語法與差異空白檢查通過。
- 本次沒有重跑瀏覽器；26/26 為 2026-10-20 的既有原生 IndexedDB 實測，不是新電腦或 10/23 的證據。

目前最重要的缺口是：已送出但無法完整核對的 attempt 會持續停寫，沒有人工安全解除／重建流程；同名多檔也沒有處理工具。這是保留資料的安全選擇，不能直接刪 journal 解鎖。

下一階段須先核對本報告、風險與授權，再決定接續工作；**本次沒有授權開始 P04-05～07、真實 OAuth／Drive、正式網站或其他功能**。不得自動修改 EDF Checklist／PS Game Base，或將本 POC 換成正式網站。

## 8. 新電腦可直接使用的接手提示

> 請先閱讀 docs/HANDOFF.md、docs/POC04_REPORT.md、docs/GOOGLE_DRIVE_REUSE_ANALYSIS.md，核對 git status／最新 main。此 Repo 的 P04-01～04 已完成離線驗證，先依交接步驟重跑 Node 108／160 項及原生 IDB 兩分頁／reload 26 項，區分歷史與本機新證據。保留既有格式、Tombstone、Base、Outbox 和未知寫入 journal，不修改另外兩個來源 Repo。完成環境核對後回報，尚未另外授權前不要開始 P04-05～07、真實 Google 或正式網站。

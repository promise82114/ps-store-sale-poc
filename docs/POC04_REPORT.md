# POC-04 技術驗證報告

更新日期：2026-10-23（Asia/Taipei）。技術實測範圍：**P04-03、P04-04**，沿用 P04-01、P04-02；本次只整理換機交接與提交前回歸，未擴充功能。

**最新結論：P04-03 PASS；P04-04 PASS（離線 Mock 範圍）。** Node POC-04 測試 **108/108**、完整離線回歸 **160/160**、原生 IndexedDB 瀏覽器測試 **26/26** 通過。真實 Google Drive／完整同步能力仍為 **INCONCLUSIVE**；未開始 P04-05～07。

**閱讀方式：第 1～7 節保留第一階段歷史紀錄**，當時 P04-01、P04-02 為 PASS（62/62，完整回歸 114/114）；其中「尚未實作 IDB／P04-03～07」描述當時狀態。**本次 P04-03、P04-04 的實作、正式結果與剩餘風險見第 8～12 節**。

## 1. 基礎檢查與範圍

- 依據 [GOOGLE_DRIVE_REUSE_ANALYSIS.md](GOOGLE_DRIVE_REUSE_ANALYSIS.md) 第 7、10 節；其中資料模型原為建議，這次才新增純資料層實作。
- 現有 `src/diagnostic.mjs`、`http.mjs`、`pagination.mjs`、`poc-fetch.mjs`、`query.mjs`、`runner.mjs` 都屬 POC-01，沒有個人標記或三方合併引擎，故沒有重建專案或重複移植已有模組。
- 沒有修改 EDF Checklist 或 PS Game Base，也沒有複製其 OAuth／Drive 模組；原分析文件保留原狀。
- 沒有網站、UI、IndexedDB、localStorage、outbox、OAuth、Google Drive 呼叫、Cloud 專案、額外套件或 GitHub Actions 執行。
- 純函式接收文件並傳回新文件／合併計畫；時間及 UUID 都由呼叫端注入，不讀時鐘、不使用隨機勝負。
- 本次開始時 HEAD 為 `55b713d0ef43bdf0132435e19bd850a0d8441ee2`；結果針對目前工作目錄新增內容，尚未 commit／push。

## 2. 實作前確認的歧義

三項問題已先提出，使用者均確認採建議規則；沒有增加操作因果欄位或其他使用者分類。

| 問題 | 已確認規則 | 影響 |
|---|---|---|
| 僅有 changeId，無法判斷標記是舊資料或清除後重新分類 | Tombstone 與標記相遇一律列衝突，必須明確選擇 | 即使只有一端清除，另一端仍為原標記，也需要人工選擇；不宣稱所有單邊修改都會自動合併 |
| 相同分類、不同操作中繼資料 | 固定保留 changeId 字典序較小的完整紀錄 | 不混搭欄位、不按時間勝出；交換 Local／Remote 後結果相同 |
| Base 有紀錄，某端直接缺項且沒有 Tombstone | 拒絕輸入，回報 `MISSING_DELETION_INTENT` | 缺項不代表清除，不能悄悄恢復舊標記或丟失刪除意圖 |

Base 已有 Tombstone、Local 與 Remote 卻同時帶回相同標記，也須列衝突；不能因為兩端分類相同就跨過已知的清除歷史。

## 3. 個人標記格式（schemaVersion 1）

沿用分析建議的 envelope 和兩個互斥 map。以下為合成資料，沒有公共商品欄位或憑證：

```json
{
  "schemaVersion": 1,
  "projectId": "ps-store-sale-filter",
  "updatedAt": "2026-10-20T00:00:00.000Z",
  "data": {
    "schemaVersion": 1,
    "kind": "ps-store-sale-filter-personal",
    "datasetId": "00000000-0000-4000-8000-000000000900",
    "revisionId": "00000000-0000-4000-8000-000000000901",
    "updatedAt": 1792454400000,
    "marks": {
      "zh-hant-tw:JP0000-PPSA00001_00-EDITION_A": {
        "status": "tracked",
        "changeId": "00000000-0000-4000-8000-000000000001",
        "updatedAt": 1792454400000
      }
    },
    "tombstones": {
      "zh-hant-tw:JP0000-PPSA00001_00-EDITION_B": {
        "changeId": "00000000-0000-4000-8000-000000000002",
        "updatedAt": 1792454400000
      }
    }
  }
}
```

### 3.1 身分與稀疏標記

| 項目 | 契約 |
|---|---|
| 商品識別 | 精確的 `locale:ProductID`，不依名稱、Concept ID 或遊戲家族合併 |
| 追蹤 | `marks[key].status = tracked` |
| 忽略 | `marks[key].status = ignored` |
| 未分類 | 沒有 `marks[key]`；不儲存一般 `unclassified` 紀錄 |
| 取消既有標記 | 移除 mark，新增帶新 changeId 的 Tombstone；不是第四類 |
| 從未標記／重複清除 | 不新增操作；既有 Tombstone 保留 |
| 同狀態重複操作 | 保留原操作身分，不製造無意義修改 |
| 重新分類 | 呼叫端明確操作可用新 changeId 替換 Tombstone；與舊資料合併時仍遵守衝突規則 |
| 活動結束／商品消失 | 不傳入 catalog、不刪個人資料；備份完整保留孤立紀錄 |
| Tombstone 壽命 | 本階段永久保留，沒有 TTL 或垃圾回收 |

不同語系、不同版本或不同 Product ID 都獨立；不增加購買、遊玩、價格、圖片或個人額外分類。

### 3.2 驗證與中繼資料

- 外層及 data 的 `schemaVersion` 均固定 1；projectId、kind 必須吻合；所有欄位必須存在，未知欄位拒絕，沒有默默裁掉資料的 migration。
- 尚未綁定雲端的本機文件使用 `datasetId=null`、`revisionId=null`；兩者必須同時 null。已綁定時兩者都必須是小寫 UUID（版本位 1～8、標準 variant），changeId 同樣驗證；測試注入固定 UUID v4。
- datasetId 是資料世系；revisionId 是呼叫端指定的候選內容版本，不證明已上傳／確認。`setClassification` 保留原世系及 revisionId，不把本機編輯冒充雲端成功。
- 無 Base 首同步可由未綁定 Local 採用 Remote 世系；兩份已綁定文件的世系若不同則拒絕。日常 Base 必須已綁定，B/L/R 的 datasetId 必須相同；沒有實作復原或重設流程。
- 時間為非負安全整數毫秒，範圍不超過 JavaScript Date 上限；外層 ISO 時間必須對應 data.updatedAt。紀錄時間只供診斷，時鐘倒退不阻擋新操作；不以時間認定因果或分類勝負。
- 同一文件的 changeId 不得重複；跨 B/L/R 重用相同 changeId 時，商品 key、紀錄類型、分類、時間必須完全一致，否則拒絕。
- key 語法：locale 為小寫 2～3 字母主標籤，加上一個以上 2～8 位小寫英數子標籤；Product ID 為 1～128 位大寫英數、底線或連字號，首字元為英數。這是 POC 輸入語法白名單，沒有連線驗證商品存在性或語系登錄有效性。
- marks 與 tombstones 同 key 互斥；拒絕陣列、非資料物件、accessor、危險／無效 key、未知狀態與非有限時間。
- POC 防護上限：合計 100,000 筆紀錄、UTF-8 JSON 16 MiB；並非正式產品容量承諾。匯入先檢查原文大小，驗證與合併完成輸出也檢查容量；超限拒絕，不截斷。
- `exportBackup` 以 key 排序的緊湊 JSON 輸出，使有效匯出遵守相同匯入大小上限；`importBackup` 只解析及驗證，回傳獨立文件，**不寫入或覆蓋儲存層**。還原／取代本機政策及 UI 未在本階段實作。

## 4. 首次同步與日常三方合併

### 4.1 決策順序

`planMerge({base, local, remote})` 強制提供 base；只有明確 `base:null` 才是首次同步。不存在把雲端 404／檔案遺失自動當首次同步的處理。

依序驗證文件、世系、操作身分，再逐商品處理：

| 條件 | 決策 |
|---|---|
| Base 有紀錄，L 或 R 缺少對應紀錄 | 拒絕 `MISSING_DELETION_INTENT` |
| Base 是 Tombstone，任一端是 mark | `TOMBSTONE_VS_MARK` 衝突，即使兩端 mark 相同 |
| L/R 意圖相同 | 自動合併，保留 changeId 字典序較小的完整紀錄；雙方無紀錄則仍未分類 |
| L/R 為 Tombstone 對 mark | `TOMBSTONE_VS_MARK` 衝突，優先於單邊未改判斷 |
| 首次同步單邊獨有紀錄 | 保留該 mark 或 Tombstone；另一端缺項不是刪除 |
| 首次同步追蹤對忽略 | `DIFFERENT_CLASSIFICATIONS` 衝突 |
| 日常 L 的操作未變、R 改變 | 採 R（前面的清除衝突例外已先處理） |
| 日常 R 的操作未變、L 改變 | 採 L（同上） |
| 日常兩端都改、結果不同 | `BOTH_CHANGED` 衝突 |

「未變」依操作身分判斷，已先確認同 ID 的 canonical 紀錄完全一致；不是比牆鐘、整份 JSON 字串或只比顯示分類。不同商品獨立決策，彼此不製造衝突。

### 4.2 衝突選擇介面

合併計畫包含 `mode`、`datasetId`、`ready`、無衝突的 marks／tombstones，以及按 key 排序的 conflicts。每筆衝突帶 `key/reason/base/local/remote`，明確標示 mark、Tombstone 或無紀錄。

- `ready` 只代表沒有未解衝突；最終文件仍須通過 `resolveMerge` 的完整格式／容量驗證，不能直接把計畫當完整備份。
- `resolveMerge(plan, {choices: {[key]: 'local' | 'remote'}}, metadata)`：逐筆選擇，必須涵蓋全部衝突。
- `resolveMerge(plan, {all:'local'}, metadata)` 或 `{all:'remote'}`：一次選定所有衝突；不改動原本已自動合併的其他商品。
- 遺漏、錯誤選項、未知 key、混用 all 與逐筆選項、偽造／反序列化的計畫均拒絕；沒有預設「全部本機」或「時間較新」。未選完不能產生完成文件。
- bound 計畫的 metadata 必須明確提供有效 revisionId；未綁定計畫維持 null。updatedAt 可注入，未提供則取輸入文件時間最大值，僅供 envelope 診斷。
- 計畫為凍結的獨立快照，只能在目前程序中解決；輸入或回傳結果後續改動不會污染它。重新載入後必須重新規劃。
- 明確選擇標記允許恢復分類；這是使用者選擇，不是自動將舊標記復活。選擇清除必須保留 Tombstone，後續舊備份仍會遇到衝突。

最小呼叫方式：

```js
const plan = planMerge({ base, local, remote }); // base=null 代表首次
// 由呼叫端收集必要的選擇；沒有衝突時可用 {}。
const merged = resolveMerge(plan, { all: 'local' }, {
  revisionId: '00000000-0000-4000-8000-000000000902'
});
const backupJson = exportBackup(merged);
```

這只是資料運算，沒有推進持久 Base，也沒有把結果寫回「正在修改的本機資料」。同步期間新增修改的交易／rebase 保護仍屬 P04-03，本次快照不可變測試不能取代該驗證。

## 5. 檔案及主要函式

| 檔案 | 函式／用途 |
|---|---|
| `src/poc04/personal-data.mjs` | `createDocument`、`personalKey`、`validateDocument`、`getClassification`、`setClassification`、`exportBackup`、`importBackup`；格式、分類操作與備份 |
| `src/poc04/merge.mjs` | `planMerge`、`resolveMerge`；真正的 B/L/R 比較、清單及選擇 |
| `tests/fixtures/poc04.mjs` | 合成 key、UUID、mark、Tombstone、文件工廠；不引用真實私人資料 |
| `tests/poc04-merge.test.mjs` | 20 項合併測試及 1 項跨模組離線測試 |
| `tests/poc04-personal-data.test.mjs` | 41 項格式／分類／備份測試 |
| `package.json` | 新增 `test:poc04`；`test` 限定 `tests` 目錄，避免發現 `.local` 的舊審查快照測試 |
| `README.md` | 增加本階段執行入口及報告連結 |

沒有改動 POC-01 的抓取程式、workflow 或 package-lock；既有 `graphql` 依賴不被新模組使用。

## 6. 執行結果與驗收對照

環境：Windows 本機，Node.js **v20.18.0**，npm **10.8.2**；沒有安裝套件。本次沒有 GitHub-hosted runner 結果。

| 執行 | UTC 開始時間 | 通過／總數 | 失敗／跳過 | Node runner 耗時 | 程序總耗時 | 結論 |
|---|---|---|---|---|---|---|
| POC-04 指定兩個測試檔 | 2026-10-20 09:27:17.669 | 62/62 | 0/0 | 1,033.5377 ms | 1,095.435 ms | PASS |
| `npm test` → `node --test tests` | 2026-10-20 09:28:21.448 | 114/114 | 0/0 | 1,102.1236 ms | 1,599.298 ms | PASS |

兩次正式紀錄的 exitCode 都是 0，cancelled/todo 都是 0。114 項是既有 POC-01 的 52 項，加上本次 POC-04 的 62 項。

| 驗收項目 | 實際測試內容 | 結果 |
|---|---|---|
| 純資料層／不修改輸入 | 快照凍結、輸入與結果分離；停用 fetch 時照常執行；Node 無 IDB/localStorage | PASS |
| 三類與 Tombstone | tracked → ignored → unclassified、重複清除、從未標記、明確重新分類 | PASS |
| 首次同步 | 單邊紀錄、兩端空、相同分類、追蹤對忽略、Tombstone 對標記 | PASS |
| 真正日常三方 | 使用完整 Base 判斷單邊修改；相同分類但操作改變不誤判未改 | PASS |
| 不同商品與語系 | 不同商品自動合併，同 Product ID 跨 locale 獨立；不同版本不繼承 | PASS |
| 同商品衝突及選擇 | 清單、逐筆混合、全部本機、全部雲端；部分／錯誤選項拒絕 | PASS |
| 防自動復活 | 首次／日常、雙向 mark/clear、Base 清除但雙端舊 mark、舊備份再次加入 | PASS |
| 穩定性與時鐘偏差 | 相同分類以較小 changeId 決定；較新 updatedAt 不取得優先；交換端點結果一致 | PASS |
| 格式與備份 | 孤立紀錄、未綁定世系、匯出匯入往返、排序穩定、缺欄位拒絕 | PASS |
| 隔離與錯誤輸入 | 外專案、未來 schema、未知欄位、憑證、價格、圖片、遊玩／購買欄位拒絕 | PASS |
| 容量與操作完整性 | 超量紀錄、UTF-8 大小、合併後超量、changeId 重用、無 Tombstone 缺項拒絕 | PASS |

狀態矩陣是上述 62 項測試中的 2 項：首次同步枚舉 **16 組**，日常 Base/Local/Remote 枚舉 **64 組**，並非另外增加 80 項測試。日常其中 21 組因 Base 紀錄缺失而預期拒絕，其餘 43 組檢查自動結果或明確衝突；同時檢查輸入不變、端點對稱、合併後作為新共同快照時的固定點。這是有限狀態驗證，不宣稱涵蓋任意歷史或分散式執行。

執行過程曾發現原 `node --test` 掃描 `.local` 審查快照而列出 294 項。已將測試範圍限定為本 Repo 的 `tests`，重新執行；正式結果只採上表 114 項，額外 180 項不列為本階段證據。無非預期測試失敗；預期錯誤全部經斷言確認，沒有吞掉錯誤以宣告通過。

本機可重現命令：

```powershell
npm run test:poc04
npm test
```

已保存的原始結果（`artifacts/` 被既有 .gitignore 排除）：

- `artifacts/poc04/poc04-tests.tap`：62 項正式紀錄。
- `artifacts/poc04/all-offline-tests.tap`：本 Repo 114 項正式紀錄。
- `artifacts/poc04/test-results.json`：命令、時間、統計、環境及被排除的初次掃描說明。
- `artifacts/poc04/preliminary-unscoped-tests.tap`：範圍修正前紀錄，不能當本 Repo 測試數。

以上為本機檔案，沒有上傳到 GitHub Actions Artifact，不宣稱有可下載的雲端 Artifact。

## 7. 結論、限制與後續待確認

| 層級 | 判定 | 證據界線 |
|---|---|---|
| P04-01 純三方合併 | **PASS** | 本機合成資料、已確認的保守 Tombstone 規則 |
| P04-02 稀疏個人格式與備份 | **PASS** | 記憶體 JSON、驗證與分類操作，無持久儲存 |
| GitHub-hosted runner 本階段驗證 | **INCONCLUSIVE** | 沒有執行 |
| 完整 POC-04／Google Drive 同步可用 | **INCONCLUSIVE** | P04-03～07 未開始；本階段不涵蓋真實授權、並行條件寫入、交易或故障恢復 |

目前沒有阻擋 P04-01、P04-02 的未決合併規則。仍有以下明確界線，留待後續另行授權，不在本次擴充：

1. 若未來希望清除／重新分類自動合併，需另決定操作因果資訊；目前採已確認的人工衝突政策，不能靠 UUID 字典序推斷新舊。
2. 防復活依賴仍保留的 Tombstone／Base。若清除歷史在所有輸入均被刪掉，僅憑現有格式無法還原歷史；因此不回收 Tombstone，也不自動接受缺少 Base 紀錄的日常輸入。
3. 備份解析不等於持久還原；匯入取代、重建世系、帳號綁定與 Base 確認時機須由後續協調器明確處理。
4. 本次沒有保存 Base、IDB、outbox 或 rebase；不能宣稱已防止同步期間新修改被持久寫回覆蓋，也沒有雙裝置原子性證據。
5. 沒有 ETag／If-Match transport mock、真實 OAuth、Drive、同名檔競態或故障恢復驗證。本機 PASS 不替代 P04-03～07 驗收。

## 8. 第二階段範圍與實際重用

本次只執行 P04-03、P04-04。既有 `personal-data.mjs`、`merge.mjs`、其 62 項測試及合成 fixtures 保持原狀；沿用已確認的 schema、三方合併及保守 Tombstone 衝突政策。

參考先前唯讀審查快照 PS Game Base `9ab49834adfc17252c2f4c28ba910d77ab3fc9fd` 的 `dist/shared/drive-appdata.js`：保留 v2 resource JSON ETag、v2 PUT／If-Match、缺保護停寫、412 停止、同名多檔停止的邊界。沒有直接搬入其 OAuth／window IIFE／遊戲庫模型；本 POC transport 強制注入 Mock request，沒有預設 fetch 或 Token 路徑，也沒有實際 Google 呼叫。

| 新增檔案 | 主要介面／責任 |
|---|---|
| `src/poc04/indexeddb-store.mjs` | `openPersonalStore`；原生 IndexedDB 讀取及原子交易 adapter |
| `src/poc04/sync-state.mjs` | `classify/begin/stage/sending/failed/cancelPrepared/acknowledge`；可離線測試的狀態轉換與 rebase |
| `src/poc04/drive-transport.mjs` | `createMockableDrive/read/write`、`validateFile/strongETag`；HTTP 形狀的 Mock 可注入傳輸 |
| `src/poc04/sync-session.mjs` | `prepareSync/uploadPrepared/recoverSync`；串接快照、既有引擎、傳輸及本機確認 |
| `tests/poc04-sync-state.test.mjs` | 17 項邊界／回執／Outbox／修訂號測試 |
| `tests/poc04-transport.test.mjs` | 29 項 ETag／狀態碼／逾時／斷網／建立競態／格式測試 |
| `tests/fixtures/mock-drive.mjs` | 純離線合成 HTTP backend、可控延遲與故障點，沒有真實 fetch |
| `tests/browser/poc04.html`、`poc04-browser.mjs` | 原生 IndexedDB 及兩個獨立分頁的合成驗證入口；只有測試文字，沒有產品 UI |
| `tools/poc04-browser-server.mjs` | 只綁定 127.0.0.1:4184 的測試檔案伺服器及本機結果保存 |

沒有修改 EDF Checklist、PS Game Base、POC-01 抓取模組、Actions workflow 或 package-lock，沒有增加套件。原分析報告保持原狀。未 commit／push。

## 9. P04-03 儲存與期間修改保護

### 9.1 最小持久資料

資料庫預設名稱 `ps-store-sale-filter-poc04`、版本 1；object store `state`、key `personal`。所有測試均另外使用 `poc04-test-<run>-...` 名稱，不讀寫正式個人資料來源，不清除其他資料庫。

同一筆聚合紀錄保存：

```text
schemaVersion: 1
document: 現有 envelope（marks + tombstones）
base: null 或已確認的完整雲端 envelope
remote: null 或已確認的 {id, name, version, size, etag}
localRevision: 本機單調遞增整數
outbox[key]: {changeId, localRevision}
attempt: null 或 {id, stage, snapshot, candidate, expected, error}
lastConfirmed: null 或 {attemptId, revisionId}
```

- 每次有效分類修改，在同一 readwrite 交易讀取最新資料，保存 document、新 changeId、遞增 localRevision 及該商品最新待同步操作。重複同分類／從未標記的清除仍沿用 P04-02 的 no-op 規則。
- 呼叫端提供新 UUID／時間，adapter 自動產生本機修訂號；拒絕目前紀錄、Base 或已知同步快照中的 changeId 重用。Outbox 每商品只保留最新操作，不另擴充事件歷史模型。
- 每次操作均重新從 IDB 讀取；沒有以分頁內快取的舊整份資料直接覆寫。跨連線／跨分頁 readwrite 交易由原生 IDB 排序。
- 只有 transaction `complete` 才回報成功；put 的 success 不等於整筆交易成功。失敗或 abort 不重建、不清空資料庫。
- 開啟失敗、blocked、versionchange 不觸發刪庫／格式降級；未知儲存版本、損壞 journal、Outbox 與文件不符或缺少待同步操作時拒絕寫回。
- localRevision 在有效分類及成功套用確認結果時遞增；單純準備／更新 attempt 不改分類修訂號。Base、Outbox、文件及 attempt 的成功確認同交易提交。

### 9.2 快照、上傳、確認順序

1. `begin` 原子保存 B、L0、r0、S0（Outbox）及 Remote 綁定，建立唯一 active attempt；第二分頁不可同時開新同步，但仍可分類。
2. 在 IDB 交易之外讀取 Mock Remote。`stage` 重新核對 localRevision，再呼叫既有 `planMerge/resolveMerge`。如期間有任何分類修改，回報 `STALE_SNAPSHOT`，不沿用過期選擇；此處連不同商品的修改也保守要求重新擷取。
3. 候選 M、預期 Remote 文件／file metadata 保存為 `prepared`。開始 transport 前再次驗證 r0，先原子保存 `sending`，再發出 request；不持有 IDB 交易等待網路。
4. `sending` 之後允許繼續分類。這些修改取得新 changeId／localRevision，與 M 分離；不能因為分類結果看起來相同，就認定已確認。
5. transport 驗證完整讀回 M 及有效 ETag 後才回傳 receipt。`acknowledge` 再從 IDB 讀取當前最新資料，以 M 作為 Base，並把 S0 之後的新操作（含取消標記 Tombstone）覆回最新本機文件。
6. 只有當目前 Outbox 的 changeId **及**操作 localRevision 都仍等於 S0，才清除該操作。若使用者在衝突中明確採 Remote，這代表該次捕捉的 Local 意圖已被明確取代，也可結清；期間新增的操作仍保留。
7. Base 永遠是被確認的 M，不能把 rebase 後含新修改的 Local 當成已上傳版本。確認交易失敗則 document／Base／Outbox／journal 全部維持原本已提交狀態。

同一 attempt 重複確認具有冪等性；錯誤文件、錯誤 fileId、無效 ETag、尚未送出的 attempt 都不能提交成 Base。

### 9.3 持久同步紀錄與安全停止

- `snapshot`、`prepared` 尚未發送，可明確呼叫 `cancelPrepared` 後重新規劃；取消只移除 attempt，保留所有個人資料、Base、Outbox。
- `sending`／`uncertain` 視為可能已寫入，不提供時間到自動解鎖、鎖接管或直接取消。分類及備份資料讀取仍可繼續。
- 寫入錯誤只記固定錯誤碼，不保存原始例外、伺服器回應、憑證或 Token。若連錯誤碼寫入也失敗，先前已提交的 `sending` 紀錄仍可恢復。
- `recoverSync` 僅重新讀取，要求同名唯一檔、既有綁定 fileId（如有）、有效 metadata／ETag，及 canonical **完整內容**等於已保存的候選 M；不是只比 revisionId。
- 吻合才原子確認並 rebase；不吻合、讀取失敗或同名多檔一律保留原狀且不重送。這涵蓋「上傳已成功但本機提交失敗」與「回應遺失／逾時但稍後才完成寫入」。

## 10. P04-04 Mock 傳輸安全邊界

| 情境 | 實作與已驗證行為 |
|---|---|
| 缺少／弱／空／萬用／格式錯誤 ETag | 拒絕覆寫；不採用 media header 代替 resource ETag |
| 讀取期間變動 | 比對 list、v2 metadata、media、再次 v2 metadata 的 fileId／version／ETag；不一致停止 |
| 寫入前變更／換檔 | 再列清單並核對 metadata；不符則不發 PUT |
| preflight 後競爭 | PUT 固定帶讀取的強 ETag／If-Match；412 不重試、不降級、不覆寫競爭者 |
| 401／403／429／500／503 | 單次失敗停止；本機 marks、Tombstone、Base、Outbox 保留 |
| 斷網／逾時／回應本文卡住 | request 及 body 共用逾時範圍；即使 Mock 忽略 abort 也會結束等待；不推斷未寫入 |
| 首次建立 | v3 multipart、固定檔名、appDataFolder；建立前重查，建立後再次檢查唯一性與完整內容 |
| 同時首次建立 | 兩個 Mock client 都通過空清單，再同時 POST；雙方偵測到重複而停下，兩份檔都保留 |
| 同名多檔 | 包括跨 list 分頁的重複，安全停止；沒有 DELETE、自動挑選或合併檔案 |
| 寫入後讀回不同內容 | 不發成功 receipt，不提交 Base；保留本機恢復紀錄 |
| 結果不明 | 僅 readback；不盲目 PUT／POST，不因 readback 不吻合就清 journal 或建立第三份檔 |
| 無效 JSON／外專案／未來版本／超量 | 沿用既有 schema validator 與大小上限，拒絕，不套用空資料 |

預設 timeout 為 20 秒，測試注入短時間；每個 request 不自動重試，list 最多 10 頁且拒絕重複 page token。此階段沒有 OAuth、Authorization header 或實際 Google 網路；所有 Google URL 都只傳給合成 request handler。

## 11. 第二階段正式測試結果

日期：2026-10-20（Asia/Taipei），本機 Windows；Node.js v20.18.0、npm 10.8.2。瀏覽器為 Codex in-app browser，user agent 顯示 Chromium/Chrome **155.0.0.0**。沒有 GitHub-hosted runner 執行。

| 正式執行 | 開始時間（台灣）／識別 | 通過／總數 | 失敗／跳過 | Runner 耗時 | 程序總耗時 | 結論 |
|---|---|---|---|---|---|---|
| `npm run test:poc04` | 2026-10-20 17:49:41.908 | 108/108 | 0/0 | 1,216.1234 ms | 2,035.420 ms | PASS |
| `npm test` | 2026-10-20 17:49:43.946 | 160/160 | 0/0 | 1,194.6415 ms | 1,649.302 ms | PASS |
| 原生 IndexedDB／兩分頁／Mock Drive | run=`phase2b`，origin=`http://127.0.0.1:4184` | 25/25 | 0／不設 skip | 各項時間見 JSON | — | PASS |
| 實際 browser reload 後完整狀態比對 | 同 run=`phase2b` | 1/1 | 0／不設 skip | 7.2 ms | — | PASS |

108 項 = 原有 62 + 新增 sync-state 17 + transport 29；160 項再加 POC-01 的 52 項。Node 正式兩次 exitCode=0，cancelled／todo=0。瀏覽器 26 項的各項執行時間合計 232.6 ms，**不是**含載入／工具操作的端到端總耗時，亦不計入 Node 測試數。

### 11.1 P04-03 驗收

| 需求 | 原生 IndexedDB 證據 | 結果 |
|---|---|---|
| marks／Tombstone／Base／Outbox 持久保存 | 關閉重開連線及實際頁面 reload 後比對完整 aggregate，含 prepared journal | PASS |
| 本機修訂號／changeId | 連續分類、no-op、同商品跨分頁序列化、Outbox 修訂對應；另有 Node 溢位／ID 重用測試 | PASS |
| 一致快照 | 第二個真實分頁與 begin 競爭，快照文件、r0、S0 同版 | PASS |
| 上傳期間可繼續修改 | 延遲 PUT；另一真實分頁修改同商品，主分頁清除另一商品並新增標記 | PASS |
| 舊快照不得覆寫新改動 | 成功後保留最新 mark、Tombstone 及新商品；相同顯示分類但新 changeId 也保留 | PASS |
| 僅清除已確認 S0 | 未變操作清除，新操作保留，changeId／localRevision 與最新文件一致 | PASS |
| 寫入失敗／reload／跨分頁 | 原生 put success 後 abort、quota 型同步 throw，舊資料不變；兩分頁同／不同商品操作都序列化 | PASS |
| Base 只代表已確認版本 | Base=M；Local=M+後續操作，兩者可不同；雲端成功而 IDB abort 時 Base 不前進 | PASS |

### 11.2 P04-04 驗收

29 項 Node transport 測試加上原生 IDB 整合情境，覆蓋上述第 10 節所有安全停止條件。特別實測：

- 401／403／429／500／503／412 前後比較保存的 document、Base、Outbox、localRevision、remote metadata；只有 attempt 的狀態／錯誤碼改變。
- Mock 雲端成功後，注入本機 transaction abort，關閉重開 IDB，再以只讀恢復；新本機修改保留，寫入次數不增加。
- 成功但回應遺失時，完整讀回候選才確認；逾時但尚未提交時先讀回不吻合，保持停寫，稍後 Mock 晚到提交完成才讀回確認，始終只有一次 PUT。
- 首次建立後出現同名多檔時，Local／Outbox／Base 保留，兩個 Mock 檔案都保留；恢復也因 duplicate 停止。

### 11.3 重現與結果檔

```powershell
npm run test:poc04
npm test
npm run test:poc04:browser
```

瀏覽器驗證使用同一 origin 的兩個獨立分頁：

1. 先開 `http://127.0.0.1:4184/tests/browser/poc04.html?run=manual1&mode=peer`，確認 peer ready。
2. 再開 `http://127.0.0.1:4184/tests/browser/poc04.html?run=manual1`，等待 initial 結論；每次新的完整執行須使用新 run 字串，避免沿用前次測試資料庫。
3. 對第二頁執行真正重新整理，應顯示 reload 結論；第二分頁保持開啟供跨分頁測試使用。

這是合成驗證頁，不是正式網站。伺服器只提供限定路徑與本機結果端點，CSP 限定同源，沒有外站 script 或連線。Node 的 `npm test` 不會代跑瀏覽器頁，兩種證據分開保存。

正式產物位於既有忽略目錄 `artifacts/poc04/phase2/`：

- `test-results.json`：整合本階段 Node／browser 摘要與結論。
- `node-results.json`、`poc04-tests.tap`、`all-offline-tests.tap`：兩次 Node 正式執行證據。
- `browser-initial.json`、`browser-reload.json`：最終 run=phase2b 的 25+1 項結果。
- `browser-reload.png`：實際重新整理後 PASS 結果的原生瀏覽器截圖。
- `reload-expected.json`：合成 aggregate，供實際 reload 完整比對，不是正式個人資料。
- 帶 `preliminary` 的 browser JSON 是強化驗證前的首輪紀錄；正式計數只採 phase2b，沒有加總重複執行。

本次所有正式測試均通過，沒有非預期失敗或略過。產物僅在本機，未上傳／提交公開資料，沒有 Actions Artifact 驗證或部署聲明。

## 12. 最新結論與未解決風險

| 範圍 | 結論 | 限定 |
|---|---|---|
| P04-01、P04-02 | **PASS** | 原 62 項測試完整保留並再次通過，原格式／合併規則不變 |
| P04-03 | **PASS** | Chromium 原生 IDB、實際兩分頁、實際頁面重新整理及合成故障 |
| P04-04 | **PASS** | Mock HTTP／Mock Drive；含真實本機 IDB 整合，沒有真實雲端 |
| P04-05～07／完整同步模組可用 | **INCONCLUSIVE** | 本次未開始，尚無真實 Google、雙裝置或完整端到端恢復證據 |

已確認的三項第一階段合併規則仍有效，沒有新增分類、版本繼承或操作因果格式。本次依原分析的安全停止／快照確認規則執行，沒有新的未決規則阻擋 P04-03、P04-04；以下風險不以離線 PASS 掩蓋：

1. **保留未知結果會犧牲可繼續同步性。** 已送出且讀回不吻合的 attempt（包括被拒絕的 HTTP、晚到請求或雲端又被別人修改）保持停寫；不提供自動解鎖、逾時接管、強制放棄或人工重建 UI。使用者仍可分類及讀出 JSON 備份。後續若要恢復一般同步，須另訂可證明安全的解除／重新規劃協定，不能直接刪 journal 再送舊資料。
2. **建立後檢查不是按檔名的原子唯一建立。** 已驗證既有／觀測到的重複會停寫，兩個同時建立者在受控排程中都偵測重複；無法保證檢查之後沒有第三方再建檔。未建立多檔處理工具，也沒有自動刪除。
3. **IDB 成功範圍。** 已驗證目前 Chromium 的交易中止、quota 型 throw、兩分頁及頁面 reload；沒有實際耗盡整個 origin quota、斷電／OS crash、磁碟損毀、瀏覽器清除／驅逐資料、其他瀏覽器或整個瀏覽器程序重啟證據。沒有要求 persistent-storage 權限，仍需保留 JSON 備份。
4. **容量與效能。** 單聚合紀錄加快照／候選／Remote 會重複保存個人資料；POC 使用小型合成資料，未對上限資料量做 IDB quota／效能承諾。失敗時不截斷、不退回空資料。
5. **真實 Drive 邊界。** CORS、v2 ETag／If-Match 是否被服務真正執行、帳號／授權隔離、401 後重新授權、真實 412／首次建立競態尚無實測；目前沒有 OAuth 能力，也未測試或加入 Token 保存。
6. **候選被後續雲端版本取代。** 候選曾上傳但現已不同時，完整 readback 不吻合就不能確認，這個最小版本會保留資料並停下；完整多輪對帳／人工復原屬後續設計，不能宣稱 P04-07 已完成。

目前可重用的是已驗證的 schema／三方合併，加上本次最小 IDB adapter、快照確認／rebase 及可注入 Mock 的條件傳輸；它們仍是 POC，尚未構成正式 Google Drive 同步產品。

## 13. 2026-10-23 換機與提交前回歸

本次將 POC-04 程式、測試、分析及報告整理入 Git，新增 [HANDOFF.md](HANDOFF.md) 作為換機入口。前面各階段的「未 commit／push」是當時快照；交付 commit 與遠端同步狀態以實際 Git 驗證為準，不修改歷史測試時間。

環境仍為本機 Windows、Node v20.18.0、npm 10.8.2；本次只重跑 Node 離線回歸：

| 命令 | 開始時間（台灣） | 通過／總數 | 失敗／跳過 | Runner 耗時 | 結論 |
|---|---|---|---|---|---|
| `npm run test:poc04` | 2026-10-23 18:46:13.712 | 108/108 | 0/0 | 1,184.1471 ms | PASS |
| `npm test` | 2026-10-23 18:46:15.560 | 160/160 | 0/0 | 1,338.2977 ms | PASS |

兩次 exitCode=0、cancelled／todo=0；來源語法檢查通過。本次沒有重跑瀏覽器、Actions、PS Store、OAuth 或 Google Drive；26/26 原生 IndexedDB 證據仍是 2026-10-20 的歷史實測，P04-05～07 維持未開始。

本次原始回歸結果存於 `artifacts/poc04/handoff-2026-10-23/`，不提交 Git；`artifacts/`、`.local/`、node_modules 與本機瀏覽器資料都不隨此次 commit／push。換機後可 clone 程式／測試／報告並重跑；如需保留既有原始證據，依交接文件在 Git 之外另行備份。

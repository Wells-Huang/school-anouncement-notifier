# 古亭國小公告每日掃描

這個 repo 以 GitHub Actions 每天台北時間 08:00 執行，讀取古亭國小公告頁：

<https://www.gtes.tp.edu.tw/nss/p/index>

## 重要行為

- 使用 Playwright 啟動 Chromium，等待 JavaScript 動態公告表格載入；只看到「本頁面需要瀏覽器支持 JavaScript」或頁面外殼時，不會判定為無公告。
- 逐一掃描榮譽榜、校務公告、獎補助資訊、公文公告、活動/競賽、研習進修、人事服務、音樂班聯招、教師甄選。
- 讀取表格的標題、單位、日期，並點入詳細頁取得內文、發佈／最後更新日期、附件與 `/nss/main/freeze/...` 原始連結。
- RSS 與 rendered page 一併使用：RSS 提供較精確的發布時間與內容補強，但 RSS 或搜尋引擎不會被拿來單獨判定「今日無公告」。
- 分頁若沒有真正切換就停止重讀；報表寄送前會移除 Email 顯示內容完全一致的公告，同標題但內容、期限或原始連結不同者仍保留。
- 只有找到符合小五學生／家長條件的公告才寄信；收件地址由非公開的 `GMAIL_TO` Secret 提供，不寫入 repo。無相關公告、頁面讀取失敗、分類掃描不完整或寄信憑證缺失，都只寫 log，不寄掃描狀態信。
- 每次執行會產生 `logs/latest.json` 及日期目錄下的歷史 JSON log；GitHub Actions 會把 log 上傳成 artifact 並提交回 repo。

## GitHub Secrets

在 repo 的 **Settings → Secrets and variables → Actions** 建立：

- `GMAIL_TO`：收件地址。請將私人收件地址填在這個 Secret，不要寫入 workflow、程式碼或 README。
- `GMAIL_USERNAME`：可使用 SMTP 的 Gmail 發信帳號。
- `GMAIL_APP_PASSWORD`：該 Gmail 帳號的 App Password，不是一般登入密碼。需要先啟用 Google 兩步驟驗證。

GitHub-hosted runner 不能直接呼叫 Codex 的互動式 Gmail connector，因此 workflow 使用 Gmail SMTP 實際寄信；寄送結果會寫在 log 的 `email` 欄位。若不設定上述 secrets，即使找到相關公告，也會記錄「有相關公告但寄信失敗」，不會假裝已寄出。`GMAIL_TO` 未設定時，log 會明確記錄收件地址 Secret 缺失。

## 本地執行

```powershell
npm install
npx playwright install chromium
$env:GMAIL_TO = "你的私人收件地址"
$env:GMAIL_USERNAME = "你的 Gmail 發信帳號"
$env:GMAIL_APP_PASSWORD = "由 Google 產生的 App Password"
npm test
npm run scan
```

不想在本地寄信時，不要設定 Gmail secrets；掃描仍會留下 log，但有相關公告時會記錄寄信失敗原因。GitHub Actions 每日執行預設使用 `DETAIL_SCAN_MODE=recent`，只對最近 24 小時候選公告讀取詳細頁；需要完整歷史詳細頁稽核時，才在本地設定 `DETAIL_SCAN_MODE=all`。

## Log 欄位

`logs/latest.json` 包含：Asia/Taipei 執行時間、使用方法、公告頁與公告列表狀態、成功讀到的分類、最近 24 小時總數、符合條件數、略過數、完全一致公告去除數（`duplicatesRemoved`）、詳細頁成功／失敗數、符合公告完整資料、略過標題、RSS 狀態、寄信結果，以及 JavaScript shell 或讀取失敗摘要。

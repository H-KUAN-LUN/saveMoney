# 週預算記帳

把原本的 Excel 記帳表搬到網頁上：GitHub Pages 放網頁，Firebase 負責登入和存資料，公司電腦、家裡電腦、手機看到同一份帳。

邏輯和 Excel 一樣：每週預算、第一週開始日、每 7 天一週、每日平均 = 每週預算 ÷ 7、用超過 80% 顯示「快用完」、超過預算顯示「超支」、剩下的錢不帶到下週。

```
index.html              頁面
css/style.css           樣式
js/app.js               畫面與操作
js/calc.js              計算（對應 Excel 公式）
js/store.js             資料存取（Firebase／示範模式）
js/csv.js               CSV 匯入匯出
js/firebase-config.js   ← 你要填的設定
firestore.rules         ← 貼到 Firebase 的安全規則
```

`firebase-config.js` 沒填的時候是**示範模式**：資料只存在目前的瀏覽器，用來先看畫面。

---

## 設定步驟（約 15 分鐘）

### 1. 建立 Firebase 專案

1. 到 <https://console.firebase.google.com> →「建立專案」，名稱隨意（例如 `weekly-budget`），Google Analytics 可以關掉。
2. 專案首頁點 `</>`（網頁）圖示新增應用程式，暱稱隨意，**不用**勾 Firebase Hosting。
3. 畫面會給你一段 `firebaseConfig`，把裡面的值貼到 `js/firebase-config.js`。
4. 同一個檔案的 `allowedEmail` 是選填的。repo 公開時建議留空，以免公開你的 email；只讓你本人讀寫的工作由安全規則負責。

> `apiKey` 等設定放在公開 repo 沒關係，它不是密碼。真正擋住別人的是第 4 步的安全規則。

### 2. 開啟 Google 登入

1. 左側「Authentication」→「開始使用」。
2. 「登入方式」→ 選 Google → 啟用 → 選一個支援電子郵件 → 儲存。
3. 「設定」→「已授權網域」→ 新增網域，填 `你的GitHub帳號.github.io`（只填網域，不要加 `https://` 和 repo 名稱）。

### 3. 建立 Firestore 資料庫

1. 左側「Firestore Database」→「建立資料庫」（如果有版本可選，選 Standard）。
2. 位置選 `asia-east1 (Taiwan)`，建立後不能改。
3. 選「**正式版模式**」（production mode）。不要選測試模式：測試模式下 30 天內任何人都能讀寫你的資料庫。

### 4. 貼上安全規則

1. 複製 `firestore.rules` 的內容，**貼到 Console 之後**再把 `YOUR_EMAIL@gmail.com` 改成你的 Gmail（不要改 repo 裡的檔案，否則 email 會公開）。
2. Firestore Database →「規則」分頁 → 把整個檔案內容貼上 →「發布」。

### 5. 放到 GitHub Pages

1. 在 GitHub 建一個新的 repo（public，例如 `budget`）。
2. 把這個資料夾的所有檔案上傳（網頁上「Add file → Upload files」直接拖進去就可以）。
3. repo 的「Settings」→「Pages」→ Source 選「Deploy from a branch」→ Branch 選 `main`、資料夾 `/ (root)` → Save。
4. 等 1～2 分鐘，網址是 `https://你的GitHub帳號.github.io/budget/`。

> ⚠️ 不要把匯出的 CSV 或任何帳目檔案放進這個 repo，public repo 誰都看得到。帳目只存在 Firestore。

### 6. 第一次使用

1. 打開網址 → 用 Google 登入。
2. 「設定」頁確認每週預算、開始日、分類（預設值就是你 Excel 的設定）。
3. 「設定」→「選擇 CSV 檔」→ 匯入舊帳目。
4. 手機：Safari 按「分享 → 加入主畫面」，Android Chrome 按選單「加到主畫面」，之後就像 App 一樣打開。

---

## 在公司先測這幾件事

公司網路可能擋住其中一項，建議第一次設定好就在公司電腦試：

- 打得開 `https://你的帳號.github.io/budget/`
- 按登入會跳出 Google 視窗（被擋會顯示「瀏覽器擋住了登入視窗」或「連不到 Google 登入服務」）
- 記一筆之後，回家或用手機打開看得到

網站有開離線快取：網路斷掉時記的帳會先存在那台裝置，連上後自動同步。

## 常見問題

| 畫面上的訊息 | 原因 |
|---|---|
| Firebase 還沒授權這個網域 | 第 2 步的「已授權網域」沒加 `xxx.github.io` |
| Firestore 拒絕讀寫 | 規則沒發布，或規則裡的 email 和登入的帳號不同 |
| 這個帳號沒有權限 | 登入的帳號和 `firebase-config.js` 的 `allowedEmail` 不同 |
| 載不到 Firebase 程式庫 | 網路擋住 `www.gstatic.com` |

**換新的發薪週期**：到「設定」把「第一週開始日」改成新的發薪日。之前的帳目還在資料庫裡，只是不會出現在統計；「匯出 CSV」會匯出全部資料。

**在自己電腦上測試**：ES module 不能直接用 `file://` 開，要開本機伺服器：

```bash
python -m http.server 8000
# 打開 http://localhost:8000
```

用 Firebase 模式測試的話，`localhost` 預設已經在「已授權網域」裡。

## 費用

Firebase 免費的 Spark 方案每天 5 萬次讀取、2 萬次寫入，個人記帳用不完，不需要綁信用卡。網頁每次打開只讀「第一週開始日」之後的帳目，不會隨著資料變多而越讀越多。

## 進階（可以不做）

限制 API key 只能從你的網站使用：Google Cloud Console → API 和服務 → 憑證 → 點 Browser key →「應用程式限制」選「網站」，加入：

- `https://你的帳號.github.io/*`
- `https://你的專案ID.firebaseapp.com/*`（Google 登入視窗會用到，漏了會登不進去）
- `http://localhost:8000/*`（如果要在本機測試）

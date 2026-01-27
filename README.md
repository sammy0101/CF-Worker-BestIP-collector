# Cloudflare 優選 IP 測速平台 (CF-IP-SpeedTest-Cloud)

基於 Cloudflare Worker 與 KV Storage 構建的自動化優選 IP 收集、測速與分發平台。
集成了後端自動測速、瀏覽器端真實延遲測試、以及可視化的管理後台。


![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-3.3.2-blue)

## ✨ 主要功能

*   **☁️ 自動化後端更新**: 利用 Cron Triggers 定時從外部數據源 (GitHub) 拉取 IP 並在 Worker 後端進行可用性與速度測試。
*   **⚡ 瀏覽器端測速**: 在管理後台可直接進行瀏覽器端的真實延遲測試，結果更貼近用戶實際體驗。
*   **📡 智能路由系統**: 支援子域名路由，訪問不同子域名自動返回對應數據（無需 Token 即可公開訂閱）：
    *   `fast.xxx`: 返回後端測速篩選的優選 IP
    *   `browser.xxx`: 返回瀏覽器端實測的優選 IP
    *   `all.xxx`: 返回完整的 IP 庫
*   **🔐 安全管理後台**:
    *   支援密碼登入保護。
    *   Token 管理系統（用於 API 寫入權限控制）。
    *   查看系統狀態、IP 總數、更新時間。
*   **🔌 便捷 API 集成**: 提供純淨的 API 連結複製功能，方便導入 Surge, Clash, Sing-box 等工具。
*   **📊 端口資訊顯示**: 主頁面清晰列出 Cloudflare 支援的 HTTP/HTTPS 端口
*   **💾 KV 持久化存儲**: 數據存儲在 Cloudflare KV 中，確保快速讀取。

## 🛠️ 部署指南

### 1. 準備工作
*   一個 Cloudflare 帳號
*   一個託管在 Cloudflare 上的域名

### 2. 創建 KV Namespace
在 Cloudflare Dashboard 中：
1.  進入 **Workers & Pages** -> **KV**.
2.  創建一個新的 Namespace，命名為 `cloudflare_ips` (或其他你喜歡的名字)。

### 3. 創建 Worker
1.  創建一個新的 Worker。
2.  將本專案的 `worker.js` 代碼完整複製進去。
3.  在 Worker 的 **Settings** -> **Variables** 中綁定 KV：
    *   **Variable name**: `IP_STORAGE`
    *   **KV Namespace**: 選擇剛剛創建的 `cloudflare_ips`

### 4. 設置環境變數
在 Worker 的 **Settings** -> **Variables** -> **Environment Variables** 中添加：

| 變數名稱 | 描述 | 範例 |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | **(必填)** 管理後台的登入密碼 | `MySuperSecretPass123` |

### 5. 設置觸發器 (Cron Triggers)
為了讓後端自動更新 IP 庫，請設置定時任務：
1.  進入 **Settings** -> **Triggers**.
2.  點擊 **Add Cron Trigger**.
3.  建議設置為每 4 小時或每天執行一次（例如 `0 */4 * * *`）。

### 6. 設置 DNS 與子域名 (重要) 🚀
為了啟用 **智能路由** 與 **公開 API** 功能，請在您的域名 DNS 設定中新增以下 CNAME 記錄，全部指向您的 Worker 地址 (例如 `your-worker.username.workers.dev`)：

| 類型 | 名稱 (Host) | 目標 (Target) | 用途 |
| :--- | :--- | :--- | :--- |
| CNAME | `admin` | `your-worker.workers.dev` | 管理後台入口 |
| CNAME | `fast` | `your-worker.workers.dev` | 獲取後端優選 IP (API) |
| CNAME | `browser` | `your-worker.workers.dev` | 獲取本機測速結果 (API) |
| CNAME | `all` | `your-worker.workers.dev` | 獲取完整 IP 庫 (API) |

> **注意**：設定完成後，請在 Worker 的 **Settings** -> **Triggers** -> **Custom Domains** 中，將上述域名（如 `fast.yourdomain.com`）全部綁定到此 Worker。

---

## 📖 使用說明

### 進入管理後台
訪問 `https://admin.yourdomain.com` (或是您綁定的主域名)，輸入 `ADMIN_PASSWORD` 登入。

*   **立即更新庫**: 手動觸發後端更新 IP 列表。
*   **瀏覽器測速**: 點擊後會對隨機抽取的 IP 進行本地 Ping 測試。
    *   測速完成後，結果會自動同步至雲端 (`browser.xxx` 即可讀取)。
*   **Token 管理**: 用於生成 API 寫入權限的 Token (讀取數據不需要 Token)。
*   **複製連結**: 下拉選單可快速複製 `fast`, `browser`, `all` 的純淨訂閱連結。

### API 接口 (公開讀取)
無需 Token 即可訪問以下地址獲取純文本數據（適合放入訂閱轉換器）：

*   `https://fast.yourdomain.com` -> 後端自動優選 IP
*   `https://browser.yourdomain.com` -> 瀏覽器實測優選 IP
*   `https://all.yourdomain.com` -> 所有 IP 列表

*支援參數*: `?format=ip` (僅輸出 IP，不帶端口與備註)

---

## 📸 支援端口
系統主頁已內置 Cloudflare 支援的端口列表提示：
*   **HTTP**: 80, 8080, 8880, 2052, 2082, 2086, 2095
*   **HTTPS**: 443, 2053, 2083, 2087, 2096, 8443

---

## 🙏 致謝 (Credits)
本專案基於開源社群的優秀專案進行二次開發與功能增強：

*   **核心代碼基礎**: [ethgan/CF-Worker-BestIP-collector](https://github.com/ethgan/CF-Worker-BestIP-collector) - 感謝原作者提供的基礎 Worker 架構與思路。
*   **IP 數據來源**: [cmliu/cmliu](https://github.com/cmliu/cmliu) - 感謝大佬整理與維護的 Cloudflare CIDR 列表。

## ⚠️ 免責聲明
本項目僅供學習與技術研究使用。請勿將其用於任何非法用途。IP 來源取自網絡公開資源，本項目不保證 IP 的可用性與速度。

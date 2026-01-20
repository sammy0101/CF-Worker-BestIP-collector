# Cloudflare Worker 優選 IP 收集器 (V3.1.0)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

這是一個運行在 Cloudflare Workers 上的無伺服器腳本，用於自動收集、過濾並測試 Cloudflare 的優選 IP。

**V3.1.0 核心特色：本地測速，雲端同步。**
不僅擁有後端自動篩選功能，還具備瀏覽器端真實延遲測速，並能將您的本地測速結果同步至雲端 KV 儲存，隨時隨地透過 Token 訪問。

---

## 🚀 功能特點

*   **雙重測速機制**：
    *   **後端自動測速**：由 Cloudflare Edge 節點定時抓取並測試 IP 存活狀態（篩選 HTTP 200 OK）。
    *   **⚡ 瀏覽器測速**：由用戶端（您的電腦/手機）發起測速，獲取最真實的本地延遲（Latency）。
*   **雲端同步 (New)**：瀏覽器測速的最快 IP 結果會自動上傳至 KV 資料庫 (`browser_fast_ips`)，與後端自動抓取的資料分開儲存，互不衝突。
*   **機房位置偵測**：自動識別 IP 連線到的 Cloudflare 機房代碼（如 `HKG`, `SJC`, `LAX`）。
*   **智慧排序與抽樣**：內建 Fisher-Yates 洗牌算法，從龐大的 IP 庫中隨機抽取 500 個進行測試，避免永遠只測到同一批 IP。
*   **安全性管理**：
    *   支援管理員密碼登入。
    *   **Token 系統**：可生成長期有效的訪問 Token，方便腳本或第三方工具調用，支援設定過期時間。
*   **友善介面**：
    *   響應式網頁設計 (RWD)。
    *   詳細的「黑色終端機風格」測速日誌。
    *   整合 ITDog 快捷複製功能。
    *   一鍵下載/複製優質 IP 列表。

---

## 🛠️ 部署前準備

1.  一個 **Cloudflare** 帳號。
2.  開通 **Cloudflare Workers** (免費版即可)。
3.  開通 **Workers KV** (用於儲存 IP 數據)。

---

## 📦 部署教學

### 1. 建立 KV Namespace
1.  登入 Cloudflare Dashboard。
2.  前往 **Workers & Pages** -> **KV**。
3.  點擊 **Create a Namespace**。
4.  命名為 `IP_STORAGE` (建議)，點擊 Add。

### 2. 建立 Worker
1.  前往 **Workers & Pages** -> **Overview** -> **Create application** -> **Create Worker**。
2.  命名您的 Worker（例如 `cf-best-ip`），點擊 Deploy。
3.  點擊 **Edit code**。
4.  將本專案的 `worker.js` (V3.1.0) 完整代碼複製並覆蓋原本的內容。
5.  點擊右上角 **Save and deploy**。

### 3. 綁定 KV 資料庫 (重要！)
1.  回到 Worker 的設定頁面，點擊 **Settings** -> **Variables**。
2.  找到 **KV Namespace Bindings**。
3.  點擊 **Add binding**。
4.  **Variable name** 輸入：`IP_STORAGE` (必須完全一致)。
5.  **KV Namespace** 選擇您在第 1 步建立的資料庫。
6.  點擊 **Save and deploy**。

### 4. 設定管理員密碼 (重要！)
1.  在同一個 **Settings** -> **Variables** 頁面。
2.  找到 **Environment Variables**。
3.  點擊 **Add variable**。
4.  **Variable name** 輸入：`ADMIN_PASSWORD`。
5.  **Value** 輸入您想設定的密碼（例如 `123456`）。
6.  為了安全，建議點擊 **Encrypt**。
7.  點擊 **Save and deploy**。

### 5. 設定定時任務 (Cron Triggers)
1.  前往 Worker 的 **Settings** -> **Triggers**。
2.  找到 **Cron Triggers**。
3.  點擊 **Add Cron Trigger**。
4.  建議設定為每 4 小時或每天執行一次（例如 `0 */4 * * *`）。
    *   *注意：後端自動更新主要用於維持 IP 庫的新鮮度。*

---

## 📖 使用指南

### 1. 登入系統
打開 Worker 的網址，點擊右上角的「🔓 點擊登入」，輸入您在環境變數設定的密碼。

### 2. 更新 IP 庫
點擊 **「🔄 立即更新庫」**。
*   這會觸發 Cloudflare 後端去抓取最新的 CIDR 列表。
*   後端會進行初步的存活測試。
*   請等待日誌顯示「更新成功」。

### 3. 尋找最快 IP (推薦)
點擊 **「⚡ 瀏覽器測速」**。
*   系統會從庫中隨機抽取 500 個 IP。
*   由**您的瀏覽器**直接發起連線測試（真實延遲）。
*   測速完成後，頁面下方的 **「🏆 優質 IP 列表」** 會自動更新為您實測最快的 IP。
*   同時，結果會自動上傳至雲端保存。

### 4. 下載/分享結果
*   **🚀 下載優質 IP**：下載後端自動篩選的 IP。
*   **📄 查看本機測速結果**：產生一個帶 Token 的永久連結，顯示您上次瀏覽器測速上傳的結果（適合分享給手機或其他設備使用）。

---

## 🔗 API 接口說明

所有接口若未登入，需透過 Header `Authorization: Token <your_token>` 或 URL 參數 `?token=<your_token>` 訪問。

| 方法 | 路徑 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/` | 主頁面 (Web UI) |
| `POST` | `/update` | 觸發後端更新 IP 庫 |
| `POST` | `/upload-results` | 上傳瀏覽器測速結果 (JSON) |
| `GET` | `/ips` | 下載所有已收集的 IP (純文本) |
| `GET` | `/fast-ips.txt` | 下載後端自動測速的優質 IP |
| `GET` | `/browser-ips.txt`| **下載/查看您上傳的本機測速優質 IP** |
| `GET` | `/speedtest?ip=x.x.x.x` | 單一 IP 測速接口 |

---

## ⚙️ 進階配置

您可以在代碼最上方修改以下變數：

```javascript
// 自定義顯示的優質 IP 數量
const FAST_IP_COUNT = 25; 

// 瀏覽器自動測速的樣本數量
// 建議值：免費版 Worker 50，付費版 200-500
const AUTO_TEST_MAX_IPS = 500; 

// IP 來源 (CIDR 列表)
const CIDR_SOURCE_URLS = [
    'https://raw.githubusercontent.com/cmliu/cmliu/refs/heads/main/CF-CIDR.txt'
];
```

---

## 🙏 致謝 (Credits)

本專案基於開源社群的優秀專案進行二次開發與功能增強：

*   **核心代碼基礎**：**[ethgan/CF-Worker-BestIP-collector](https://github.com/ethgan/CF-Worker-BestIP-collector)** - 感謝原作者提供的基礎 Worker 架構與思路。
*   **IP 數據來源**：**[cmliu/cmliu](https://github.com/cmliu/cmliu)** - 感謝大佬整理與維護的 Cloudflare CIDR 列表。

---

## ⚠️ 免責聲明

本專案僅供學習與技術研究使用。請勿用於任何非法用途。作者不對使用本腳本產生的任何後果負責。

Cloudflare 是 Cloudflare, Inc. 的商標。本專案與 Cloudflare 無任何官方關聯。
```

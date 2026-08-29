# 🏠 宿舍記點管理系統

一個結合 **LINE Bot** 與 **Web 管理後台** 的宿舍違規記點系統，讓宿舍管理員能透過 LINE 直接記點/消點，並透過網頁後台管理學生資料、查看記點紀錄與匯出報表。

## ✨ 功能特色

### LINE Bot
- 🔗 **床位綁定**：學生輸入 `綁定 211-1` 即可將 LINE 帳號與床位連結
- 📝 **記點 / 消點**：管理員可用 `記點 211-1 1 拖鞋未收` 或直接 `@提及` 學生來記點
- 🔍 **查詢紀錄**：學生可隨時查詢自己的累計點數與違規明細
- ✅ **防重複處理**：透過 webhook event ID 過濾 LINE 重送的重複訊息
- 🔐 **簽章驗證**：所有 webhook 請求皆驗證 LINE 官方簽章，避免偽造請求

### Web 管理後台
- 👥 學生資料管理（新增 / 編輯 / 刪除 / Excel 貼上批次匯入）
- 📊 即時統計儀表板（總人數、累計點數、今日記點）
- 🏆 違規排行榜
- 📥 一鍵匯出 Excel 記點報表
- 🔑 後端登入驗證，密碼與 API 金鑰皆不暴露於前端原始碼

## 🛠 技術棧

| 類別 | 技術 |
|---|---|
| 後端 | Node.js（Vercel Serverless Functions） |
| 資料庫 | Supabase（PostgreSQL） |
| 前端 | HTML / Tailwind CSS / Vanilla JS |
| 訊息平台 | LINE Messaging API |
| 部署 | Vercel |
| Excel 匯出 | SheetJS (xlsx) |

## 🏗 系統架構

```
LINE 使用者
   │  傳送訊息
   ▼
LINE Messaging API
   │  webhook
   ▼
Vercel Serverless Function (/api/line/webhook)
   │  簽章驗證 → 解析指令 → 讀寫資料
   ▼
Supabase (PostgreSQL)
   ▲
   │  管理員登入後，透過已驗證的 API 存取
Web 管理後台 (admin.html)
   │
   ▼
管理員瀏覽器
```

## 📁 專案結構

```
├── api/
│   ├── line/
│   │   └── webhook.js      # LINE Bot 訊息處理
│   └── admin/
│       ├── login.js        # 登入驗證，比對密碼並發放 API Key
│       ├── stats.js        # 統計資料
│       ├── students.js     # 學生 CRUD
│       └── records.js      # 記點紀錄 CRUD
└── admin.html               # 管理後台前端頁面
```

## 🚀 主要指令一覽（LINE Bot）

| 指令 | 說明 |
|---|---|
| `我是誰` | 查詢自己的 LINE ID |
| `綁定 211-1` | 綁定床位 |
| `解除綁定` | 解除目前綁定的床位 |
| `查詢` / `我的記點` | 查詢個人記點紀錄 |
| `記點 211-1 1 拖鞋未收` | 管理員記點（格式：寢室-床號 點數 原因） |
| `消點 211-1 1 主動打掃` | 管理員消點 |

## 📌 待優化方向

- [ ] 後台登入改為完整的 session token 機制（目前為簡化版 API Key 驗證）
- [ ] API 加入速率限制，防止暴力嘗試
- [ ] 記點紀錄新增審核流程，避免誤記

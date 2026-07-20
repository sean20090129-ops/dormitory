# Dorm LINE Webhook

這是宿舍記點系統的 LINE Webhook 後端。

支援 LINE 群組指令：

```text
記點 211-1 1 拖鞋未收
```

格式：

```text
記點 寢室-床號 點數 原因
```

## 需要的環境變數

部署到 Vercel 後，在 Project Settings -> Environment Variables 新增：

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Webhook URL

部署後，LINE Developers 的 Webhook URL 填：

```text
https://你的-vercel-project.vercel.app/api/line/webhook
```

然後打開：

```text
Use webhook
```

並按 Verify。

## Supabase 資料要求

`students` 表需要有對應床位：

```text
room = 211
bed = 1
```

LINE 收到：

```text
記點 211-1 1 拖鞋未收
```

就會新增一筆 `violation_records`。

## 回覆範例

成功：

```text
已登記成功
211-1 測試學生
+1 點
原因：拖鞋未收
```

找不到學生：

```text
找不到 211-1 的學生，請確認學生資料是否已匯入。
```

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password } = req.body || {};

  if (!password || password !== process.env.ADMIN_LOGIN_PASSWORD) {
    // 密碼錯誤時稍微延遲，增加暴力猜測的成本
    await new Promise((r) => setTimeout(r, 500));
    return res.status(401).json({ error: "密碼錯誤" });
  }

  // 密碼正確，把用來呼叫其他 admin API 的 key 回傳給前端
  // 這組 key 只有在成功登入後才會出現在瀏覽器記憶體/網路傳輸中，
  // 不會寫死在網頁原始碼裡
  return res.status(200).json({ apiKey: process.env.ADMIN_API_KEY });
}

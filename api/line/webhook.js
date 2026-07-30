// api/line/webhook.js
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const lineChannelSecret = process.env.LINE_CHANNEL_SECRET;
const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifyLineSignature(rawBody, req.headers["x-line-signature"])) {
    res.status(401).json({ error: "Invalid LINE signature" });
    return;
  }

  const body = JSON.parse(rawBody);
  await Promise.all((body.events || []).map(processLineEvent));
  res.status(200).json({ ok: true });
}

async function processLineEvent(event) {
  if (event.type !== "message" || event.message?.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source?.userId;
  const eventId = event.webhookEventId;

  // 防重複處理
  if (eventId && (await isDuplicateEvent(eventId))) return;

  // ========== 指令分流 ==========
  
  // 1. 綁定指令
  if (text.startsWith("綁定 ")) {
    await handleBind(event, text, userId, eventId);
    return;
  }

  // 2. 解除綁定
  if (text === "解除綁定") {
    await handleUnbind(event, userId, eventId);
    return;
  }

  // 3. 查詢自己的記點
  if (text === "查詢" || text === "我的記點") {
    await handleQuery(event, userId, eventId);
    return;
  }

  // 4. 記點指令
  if (text.startsWith("記點 ")) {
    await handleRecord(event, text, eventId);
    return;
  }
}

// ========== 綁定功能 ==========
async function handleBind(event, text, userId, eventId) {
  const match = text.match(/^綁定\s+(\d+)-(\d+)$/);
  if (!match) {
    await replyText(event.replyToken, "格式錯誤\n請輸入：綁定 寢室-床號\n例如：綁定 211-1");
    await saveLineEvent(event, text, eventId);
    return;
  }

  const [, room, bed] = match;

  // 檢查該床位是否存在
  const { data: student, error } = await supabase
    .from("students")
    .select("id,name,room,bed,line_user_id")
    .eq("room", room)
    .eq("bed", bed)
    .maybeSingle();

  if (error) {
    await replyText(event.replyToken, "查詢資料時發生錯誤，請稍後再試。");
    await saveLineEvent(event, text, eventId);
    return;
  }

  if (!student) {
    await replyText(event.replyToken, `找不到 ${room}-${bed} 的學生資料。\n請確認床位是否正確，或請管理員先匯入你的資料。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  // 檢查是否已被其他人綁定
  if (student.line_user_id && student.line_user_id !== userId) {
    await replyText(event.replyToken, `⚠️ ${room}-${bed} 已被其他 LINE 帳號綁定。\n如需換綁，請聯繫管理員。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  // 更新綁定
  const { error: updateError } = await supabase
    .from("students")
    .update({ line_user_id: userId })
    .eq("id", student.id);

  if (updateError) {
    await replyText(event.replyToken, "綁定失敗，請稍後再試。");
    await saveLineEvent(event, text, eventId);
    return;
  }

  await replyText(event.replyToken, `✅ 綁定成功！\n${room}-${bed} ${student.name}\n現在管理員可以 @你 來記點了。`);
  await saveLineEvent(event, text, eventId);
}

// ========== 解除綁定 ==========
async function handleUnbind(event, userId, eventId) {
  const { data: student } = await supabase
    .from("students")
    .select("id,name,room,bed")
    .eq("line_user_id", userId)
    .maybeSingle();

  if (!student) {
    await replyText(event.replyToken, "你目前沒有綁定任何床位。");
    await saveLineEvent(event, text, eventId);
    return;
  }

  await supabase.from("students").update({ line_user_id: null }).eq("id", student.id);
  await replyText(event.replyToken, `✅ 已解除綁定\n${student.room}-${student.bed} ${student.name}`);
  await saveLineEvent(event, text, eventId);
}

// ========== 查詢自己的記點 ==========
async function handleQuery(event, userId, eventId) {
  const { data: student } = await supabase
    .from("students")
    .select("id,name,room,bed")
    .eq("line_user_id", userId)
    .maybeSingle();

  if (!student) {
    await replyText(event.replyToken, "你尚未綁定床位。\n請先輸入：綁定 寢室-床號\n例如：綁定 211-1");
    await saveLineEvent(event, text, eventId);
    return;
  }

  const { data: records } = await supabase
    .from("violation_records")
    .select("violation_date,reason,points")
    .eq("student_id", student.id)
    .order("violation_date", { ascending: false });

  const totalPoints = records?.reduce((sum, r) => sum + r.points, 0) || 0;

  if (!records || records.length === 0) {
    await replyText(event.replyToken, `📋 ${student.room}-${student.bed} ${student.name}\n目前沒有任何記點紀錄。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  let msg = `📋 ${student.room}-${student.bed} ${student.name}\n累計：${totalPoints} 點\n\n`;
  records.slice(0, 10).forEach((r, i) => {
    msg += `${i + 1}. ${r.violation_date} +${r.points}點 ${r.reason}\n`;
  });

  if (records.length > 10) {
    msg += `\n...還有 ${records.length - 10} 筆紀錄`;
  }

  await replyText(event.replyToken, msg.trim());
  await saveLineEvent(event, text, eventId);
}

// ========== 記點功能（支援 @記點 和 寢室-床號） ==========
async function handleRecord(event, text, eventId) {
  const mentionees = event.message.mention?.mentionees || [];
  let student = null;
  let parsed = null;

  if (mentionees.length > 0) {
    // 模式 A: @某人 記點
    const targetUserId = mentionees[0].userId;
    
    // 從 text 中移除 @標記，取得剩餘內容
    const mentionText = event.message.mention.mentionees[0].text || "";
    const remainingText = text.replace(mentionText, "").trim();
    parsed = parsePointsAndReason(remainingText);

    if (!parsed.ok) {
      await replyText(event.replyToken, parsed.message);
      await saveLineEvent(event, text, eventId);
      return;
    }

    const { data: foundStudent, error } = await supabase
      .from("students")
      .select("id,name,student_number,room,bed")
      .eq("line_user_id", targetUserId)
      .maybeSingle();

    if (error) {
      await replyText(event.replyToken, "查詢學生資料時發生錯誤，請稍後再試。");
      await saveLineEvent(event, text, eventId);
      return;
    }

    if (!foundStudent) {
      await replyText(event.replyToken, "⚠️ 這位同學尚未綁定 LINE 帳號。\n請讓他輸入「綁定 寢室-床號」來綁定。");
      await saveLineEvent(event, text, eventId);
      return;
    }

    student = foundStudent;

  } else {
    // 模式 B: 寢室-床號 記點
    parsed = parseRecordCommand(text);
    if (!parsed.ok) {
      await replyText(event.replyToken, parsed.message);
      await saveLineEvent(event, text, eventId);
      return;
    }

    const { room, bed } = parsed.data;
    const { data: foundStudent, error: studentError } = await supabase
      .from("students")
      .select("id,name,student_number,room,bed")
      .eq("room", room)
      .eq("bed", bed)
      .maybeSingle();

    if (studentError) {
      await replyText(event.replyToken, "查詢學生資料時發生錯誤，請稍後再試。");
      await saveLineEvent(event, text, eventId);
      return;
    }

    if (!foundStudent) {
      await replyText(event.replyToken, `找不到 ${room}-${bed} 的學生，請確認學生資料是否已匯入。`);
      await saveLineEvent(event, text, eventId);
      return;
    }

    student = foundStudent;
  }

  const { points, reason } = parsed.data;
  const bedCode = `${student.room}-${student.bed}`;

  const { error: insertError } = await supabase.from("violation_records").insert({
    student_id: student.id,
    violation_date: new Date().toISOString().slice(0, 10),
    reason,
    points,
    excluded_from_totals: false,
    created_by: event.source?.userId || "line"
  });

  if (insertError) {
    await replyText(event.replyToken, "新增記點失敗，請稍後再試。");
    await saveLineEvent(event, text, eventId);
    return;
  }

  await saveLineEvent(event, text, eventId);
  await replyText(
    event.replyToken,
    `✅ 已登記成功\n${bedCode} ${student.name}\n+${points} 點\n原因：${reason}`
  );
}

// ========== 解析函數 ==========
function parseRecordCommand(text) {
  const match = text.match(/^記點\s+(\d+)-(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return {
      ok: false,
      message: "格式錯誤\n請輸入：記點 寢室-床號 點數 原因\n例如：記點 211-1 1 拖鞋未收"
    };
  }

  const [, room, bed, pointsText, reasonText] = match;
  const points = Number(pointsText);
  const reason = reasonText.trim();

  if (!Number.isInteger(points) || points < 1 || points > 20) {
    return { ok: false, message: "點數格式錯誤，請輸入 1 到 20 的整數。" };
  }

  if (!reason) {
    return { ok: false, message: "請輸入違規原因。" };
  }

  return { ok: true, data: { room, bed, points, reason } };
}

function parsePointsAndReason(text) {
  const clean = text.replace(/^記點\s*/, "").trim();
  const match = clean.match(/^(\d+)\s+(.+)$/);
  
  if (!match) {
    return {
      ok: false,
      message: "格式錯誤\n@記點 格式：記點 @某人 點數 原因\n例如：記點 @王小明 1 拖鞋未收"
    };
  }

  const [, pointsText, reasonText] = match;
  const points = Number(pointsText);
  const reason = reasonText.trim();

  if (!Number.isInteger(points) || points < 1 || points > 20) {
    return { ok: false, message: "點數格式錯誤，請輸入 1 到 20 的整數。" };
  }

  if (!reason) {
    return { ok: false, message: "請輸入違規原因。" };
  }

  return { ok: true, data: { points, reason } };
}

// ========== 工具函數 ==========
async function isDuplicateEvent(eventId) {
  const { data } = await supabase
    .from("line_events")
    .select("id")
    .eq("webhook_event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

async function saveLineEvent(event, text, eventId) {
  if (!eventId) return;
  await supabase.from("line_events").insert({
    webhook_event_id: eventId,
    group_id: event.source?.groupId || event.source?.roomId || null,
    user_id: event.source?.userId || null,
    message_text: text
  });
}

async function replyText(replyToken, text) {
  if (!replyToken) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineChannelAccessToken}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

function verifyLineSignature(rawBody, signature) {
  if (!lineChannelSecret || !signature) return false;
  const digest = crypto.createHmac("sha256", lineChannelSecret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

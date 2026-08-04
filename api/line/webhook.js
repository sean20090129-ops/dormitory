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

  if (eventId && (await isDuplicateEvent(eventId))) return;

  // ========== 指令分流 ==========
  if (text === "我是誰") {
    await replyText(event.replyToken, `你的 LINE ID：\n${userId}\n\n請把這串 ID 給管理員設定。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  if (text.startsWith("綁定")) {
    await handleBind(event, text, userId, eventId);
    return;
  }

  if (text === "解除綁定") {
    await handleUnbind(event, text, userId, eventId);
    return;
  }

  if (text === "查詢" || text === "我的記點") {
    await handleQuery(event, text, userId, eventId);
    return;
  }

  if (text.startsWith("記點")) {
    await handleRecord(event, text, eventId, false);
    return;
  }

  if (text.startsWith("消點")) {
    await handleRecord(event, text, eventId, true);
    return;
  }
}

// ========== 綁定功能（空格可選） ==========
async function handleBind(event, text, userId, eventId) {
  const match = text.match(/^綁定\s*(\d+)-(\d+)$/);
  if (!match) {
    await replyText(event.replyToken, "格式錯誤\n請輸入：綁定 寢室-床號\n例如：綁定 211-1");
    await saveLineEvent(event, text, eventId);
    return;
  }

  const [, room, bed] = match;

  const { data: targetStudent, error } = await supabase
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

  if (!targetStudent) {
    await replyText(event.replyToken, `找不到 ${room}-${bed} 的學生資料。\n請確認床位是否正確，或請管理員先匯入你的資料。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  const { data: oldBind } = await supabase
    .from("students")
    .select("id,name,room,bed")
    .eq("line_user_id", userId)
    .maybeSingle();

  if (oldBind && oldBind.id !== targetStudent.id) {
    await supabase
      .from("students")
      .update({ line_user_id: null })
      .eq("id", oldBind.id);
  }

  if (targetStudent.line_user_id && targetStudent.line_user_id !== userId) {
    await replyText(event.replyToken, `⚠️ ${room}-${bed} 已被其他 LINE 帳號綁定。\n如需換綁，請聯繫管理員。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  const { error: updateError } = await supabase
    .from("students")
    .update({ line_user_id: userId })
    .eq("id", targetStudent.id);

  if (updateError) {
    await replyText(event.replyToken, "綁定失敗，請稍後再試。");
    await saveLineEvent(event, text, eventId);
    return;
  }

  let msg = `✅ 綁定成功！\n${room}-${bed} ${targetStudent.name}\n現在管理員可以 @你 來記點了。`;
  if (oldBind && oldBind.id !== targetStudent.id) {
    msg = `✅ 已從 ${oldBind.room}-${oldBind.bed} 換到 ${room}-${bed}\n${targetStudent.name}\n管理員 @你 會記到新的床位。`;
  }

  await replyText(event.replyToken, msg);
  await saveLineEvent(event, text, eventId);
}

// ========== 解除綁定 ==========
async function handleUnbind(event, text, userId, eventId) {
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

// ========== 查詢記點 ==========
async function handleQuery(event, text, userId, eventId) {
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
    const sign = r.points > 0 ? '+' : '';
    msg += `${i + 1}. ${r.violation_date} ${sign}${r.points}點 ${r.reason}\n`;
  });

  if (records.length > 10) {
    msg += `\n...還有 ${records.length - 10} 筆紀錄`;
  }

  await replyText(event.replyToken, msg.trim());
  await saveLineEvent(event, text, eventId);
}

// ========== 記點 / 消點 功能 ==========
async function handleRecord(event, text, eventId, isDeduct) {
  const senderId = event.source?.userId;
  const actionName = isDeduct ? "消點" : "記點";

  // ===== 管理員權限檢查 =====
  const { data: sender } = await supabase
    .from("students")
    .select("role")
    .eq("line_user_id", senderId)
    .maybeSingle();

  if (!sender || sender.role !== 'admin') {
    await replyText(event.replyToken, `⚠️ 只有管理員可以${actionName}。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  const mentionees = event.message.mention?.mentionees || [];
  let student = null;
  let parsed = null;

  if (mentionees.length > 0) {
    // 模式 A: @某人 記點/消點
    const targetUserId = mentionees[0].userId;
    const mention = mentionees[0];
    const remainingText = (text.substring(0, mention.index) + text.substring(mention.index + mention.length)).trim();
    parsed = parsePointsAndReason(remainingText, isDeduct);

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
    // 模式 B: 寢室-床號 記點/消點
    parsed = parseRecordCommand(text, isDeduct);
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

  const { points: inputPoints, reason } = parsed.data;
  const finalPoints = isDeduct ? -Math.abs(inputPoints) : Math.abs(inputPoints);
  const bedCode = `${student.room}-${student.bed}`;

  const { error: insertError } = await supabase.from("violation_records").insert({
    student_id: student.id,
    violation_date: new Date().toISOString().slice(0, 10),
    reason: isDeduct ? `消點 - ${reason}` : reason,
    points: finalPoints,
    excluded_from_totals: false,
    created_by: event.source?.userId || "line"
  });

  if (insertError) {
    await replyText(event.replyToken, `${actionName}失敗，請稍後再試。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

  await saveLineEvent(event, text, eventId);

  const sign = finalPoints > 0 ? '+' : '';
  const actionEmoji = isDeduct ? '✅ 已消點' : '✅ 已登記成功';
  await replyText(
    event.replyToken,
    `${actionEmoji}\n${bedCode} ${student.name}\n${sign}${finalPoints} 點\n原因：${reason}`
  );
}

// ========== 解析函數（修正版：更寬鬆） ==========
function parseRecordCommand(text, isDeduct) {
  const prefix = isDeduct ? '消點' : '記點';

  // 移除 prefix，然後解析後面的內容
  const prefixRegex = new RegExp(`^${prefix}\s*`);
  const body = text.replace(prefixRegex, '').trim();

  // 寬鬆匹配：寢室-床號 點數 原因
  // [\-－] 支援半形和全形連字符
  const match = body.match(/^(\d+)[\-－](\d+)\s+(\d+)\s+(.+)$/);

  console.log('DEBUG parseRecordCommand:', { text, prefix, body, match: !!match });

  if (!match) {
    return {
      ok: false,
      message: `格式錯誤\n請輸入：${prefix} 寢室-床號 點數 原因\n例如：${prefix} 211-1 1 拖鞋未收`
    };
  }

  const [, room, bed, pointsText, reasonText] = match;
  const points = Number(pointsText);
  const reason = reasonText.trim();

  if (!Number.isInteger(points) || points < 1 || points > 20) {
    return { ok: false, message: "點數格式錯誤，請輸入 1 到 20 的整數。" };
  }

  if (!reason) {
    return { ok: false, message: "請輸入原因。" };
  }

  return { ok: true, data: { room, bed, points, reason } };
}

function parsePointsAndReason(text, isDeduct) {
  const prefix = isDeduct ? '消點' : '記點';
  const clean = text.replace(new RegExp(`^${prefix}\s*`), "").trim();
  const match = clean.match(/^(\d+)\s+(.+)$/);

  console.log('DEBUG parsePointsAndReason:', { text, clean, match: !!match });

  if (!match) {
    return {
      ok: false,
      message: `格式錯誤\n@${isDeduct ? '消點' : '記點'} 格式：${prefix} @某人 點數 原因\n例如：${prefix} @王小明 1 拖鞋未收`
    };
  }

  const [, pointsText, reasonText] = match;
  const points = Number(pointsText);
  const reason = reasonText.trim();

  if (!Number.isInteger(points) || points < 1 || points > 20) {
    return { ok: false, message: "點數格式錯誤，請輸入 1 到 20 的整數。" };
  }

  if (!reason) {
    return { ok: false, message: "請輸入原因。" };
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

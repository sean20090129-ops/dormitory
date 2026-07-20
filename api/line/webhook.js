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
  if (!text.startsWith("記點 ")) return;

  const eventId = event.webhookEventId;
  if (eventId && (await isDuplicateEvent(eventId))) return;

  const parsed = parseRecordCommand(text);
  if (!parsed.ok) {
    await replyText(event.replyToken, parsed.message);
    await saveLineEvent(event, text, eventId);
    return;
  }

  const { room, bed, points, reason, bedCode } = parsed.data;
  const { data: student, error: studentError } = await supabase
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

  if (!student) {
    await replyText(event.replyToken, `找不到 ${bedCode} 的學生，請確認學生資料是否已匯入。`);
    await saveLineEvent(event, text, eventId);
    return;
  }

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
    `已登記成功\n${bedCode} ${student.name}\n+${points} 點\n原因：${reason}`
  );
}

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

  return {
    ok: true,
    data: {
      room,
      bed,
      points,
      reason,
      bedCode: `${room}-${bed}`
    }
  };
}

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
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

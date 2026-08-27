import { createClient } from "@supabase/supabase-js";
import { checkAdminAuth } from "../_auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!checkAdminAuth(req, res)) return;

  try {
    if (req.method === "GET") {
      const { student_id } = req.query;
      let query = supabase
        .from("violation_records")
        .select(`
          id, violation_date, points, reason, created_by,
          students:student_id (name, room, bed)
        `)
        .order("violation_date", { ascending: false });
      if (student_id) query = query.eq("student_id", student_id);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === "POST") {
      const { student_id, points, reason } = req.body;
      if (!student_id || !points || !reason) {
        return res.status(400).json({ error: "缺少必要欄位" });
      }
      const { data, error } = await supabase.from("violation_records").insert({
        student_id,
        violation_date: new Date().toISOString().slice(0, 10),
        reason: `【消點】${reason}`,
        points: -Math.abs(Number(points)),
        excluded_from_totals: false,
        created_by: "admin_web"
      }).select();
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "缺少 id" });
      const { error } = await supabase.from("violation_records").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

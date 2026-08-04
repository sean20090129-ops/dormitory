import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ===== GET：查詢記點紀錄（支援全部或按 student_id 篩選）=====
    if (req.method === "GET") {
      const { student_id } = req.query;
      let query = supabase
        .from("violation_records")
        .select(`
          id,
          violation_date,
          points,
          reason,
          created_by,
          students:student_id (name, room, bed)
        `)
        .order("violation_date", { ascending: false });

      if (student_id) {
        query = query.eq("student_id", student_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ data });
    }

    // ===== DELETE：消點（刪除單筆記點紀錄）=====
    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "缺少 id" });

      const { error } = await supabase
        .from("violation_records")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

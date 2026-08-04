import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("violation_records")
        .select(`
          id,
          student_id,
          violation_date,
          points,
          reason,
          created_by,
          students:student_id (name, room, bed)
        `)
        .order("violation_date", { ascending: false });

      if (error) throw error;
      res.status(200).json({ data });
      return;
    }

    if (req.method === "POST") {
      const { data, error } = await supabase
        .from("violation_records")
        .insert(req.body)
        .select();
      if (error) throw error;
      res.status(200).json({ data });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

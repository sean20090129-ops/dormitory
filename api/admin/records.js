import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { data, error } = await supabase
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

    if (error) throw error;
    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const { count: totalStudents } = await supabase.from("students").select("*", { count: "exact", head: true });
    const { data: records } = await supabase.from("violation_records").select("points");
    const totalPoints = records?.reduce((sum, r) => sum + r.points, 0) || 0;

    const today = new Date().toISOString().slice(0, 10);
    const { data: todayRecords } = await supabase.from("violation_records").select("points").eq("violation_date", today);
    const todayPoints = todayRecords?.reduce((sum, r) => sum + r.points, 0) || 0;

    const { data: ranking } = await supabase
      .from("violation_records")
      .select("student_id, points, students:student_id (name, room, bed)");

    const studentMap = {};
    ranking?.forEach(r => {
      const key = r.student_id;
      if (!studentMap[key]) {
        studentMap[key] = {
          name: r.students?.name || "未知",
          room: r.students?.room || "",
          bed: r.students?.bed || "",
          total: 0,
          count: 0
        };
      }
      studentMap[key].total += r.points;
      studentMap[key].count += 1;
    });

    const topStudents = Object.values(studentMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    res.status(200).json({
      totalStudents: totalStudents || 0,
      totalRecords: records?.length || 0,
      totalPoints,
      todayPoints,
      topStudents
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

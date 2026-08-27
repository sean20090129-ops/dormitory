import { createClient } from "@supabase/supabase-js";
import { checkAdminAuth } from "../_auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!checkAdminAuth(req, res)) return;

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase.from("students").select("*").order("room").order("bed");
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === "POST") {
      const { data, error } = await supabase.from("students").insert(req.body).select();
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === "PUT") {
      const { id, ...updateData } = req.body;
      if (!id) return res.status(400).json({ error: "缺少 id" });
      const { data, error } = await supabase.from("students").update(updateData).eq("id", id).select();
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "缺少 id" });

      await supabase.from("violation_records").delete().eq("student_id", id);
      const { error } = await supabase.from("students").delete().eq("id", id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

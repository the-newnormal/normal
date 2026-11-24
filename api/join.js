// POST /api/join
// Receives an application from join.html, checks it against join-form.json, and saves it
// to Normal's own database (read it at admin.newnormal.sg).
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   DATABASE_URL      set automatically when you add the Neon (Postgres) database in Vercel → Storage
// Optional:
//   FILLOUT_API_KEY   also send a copy to the old Fillout recruitment form
//   FILLOUT_API_BASE  defaults to https://api.fillout.com/v1/api

const { db } = require("../lib/db");
const { form, columnId, check } = require("../lib/form");

async function copyToFillout(answers) {
  const key = process.env.FILLOUT_API_KEY;
  if (!key) return false;
  const base = process.env.FILLOUT_API_BASE || "https://api.fillout.com/v1/api";
  const r = await fetch(`${base}/forms/${form.fillout.formId}/submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      submissions: [{
        questions: Object.entries(answers).map(([id, value]) => ({ id, value })),
        submissionTime: new Date().toISOString(),
      }],
    }),
  });
  if (!r.ok) throw new Error(`Fillout ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body.answers !== "object") return res.status(400).json({ error: "bad_request" });

  // a hidden field real people never fill in
  if (body.website) return res.status(200).json({ ok: true });

  const { missing, answers } = check(body.answers);
  if (missing.length) return res.status(400).json({ error: "missing", missing });

  let saved = false;
  try {
    const q = await db();
    if (q) {
      const col = (c) => answers[columnId[c]] ?? null;
      await q(
        `insert into applications (name, phone, telegram, dob, life_stage, school, answers)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [col("name"), col("phone"), col("telegram"), col("dob"), col("life_stage"), col("school"), JSON.stringify(answers)]
      );
      saved = true;
    }
  } catch (e) {
    console.error("Could not save the application", e);
    return res.status(502).json({ error: "database" });
  }

  try {
    if (await copyToFillout(answers)) saved = true;
  } catch (e) {
    // the database copy is the one that matters
    console.error("Could not copy the application to Fillout", e);
  }

  if (!saved) return res.status(503).json({ error: "not_configured" });
  return res.status(200).json({ ok: true });
};

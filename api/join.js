// POST /api/join
// Receives an application from join.html, checks it against join-form.json,
// and sends it to Normal's recruitment form on Fillout as a new submission.
//
// Needs one environment variable in Vercel (Project → Settings → Environment Variables):
//   FILLOUT_API_KEY   from Fillout: Settings → Developer → API key
// Optional:
//   FILLOUT_API_BASE  defaults to https://api.fillout.com/v1/api (EU accounts: https://eu-api.fillout.com/v1/api)
//
// Note from Fillout's docs: submissions created through the API show up in the form's
// Results, but do not run the form's integrations, workflows or email notifications.

const form = require("../join-form.json");

const API_BASE = process.env.FILLOUT_API_BASE || "https://api.fillout.com/v1/api";
const MAX_TEXT = 20000;

const questions = form.steps.flatMap((s) => s.questions);

function clean(q, raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  switch (q.type) {
    case "short":
    case "long": {
      if (typeof raw !== "string") return undefined;
      const v = raw.trim().slice(0, MAX_TEXT);
      return v || undefined;
    }
    case "date":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    case "choice":
      return q.options.includes(raw) ? raw : undefined;
    case "consent":
      return raw === true ? true : undefined;
    case "matrix": {
      if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const out = {};
      for (const [row, col] of Object.entries(raw)) {
        if (q.rows.includes(row) && q.columns.includes(col)) out[row] = col;
      }
      return Object.keys(out).length ? out : undefined;
    }
    default:
      return undefined;
  }
}

function complete(q, v) {
  if (q.type === "matrix" && v) return q.rows.every((r) => r in v);
  return v !== undefined;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const answers = body && typeof body.answers === "object" ? body.answers : null;
  if (!answers) return res.status(400).json({ error: "bad_request" });

  // a hidden field real people never fill in
  if (body.website) return res.status(200).json({ ok: true });

  const missing = [];
  const payload = [];
  for (const q of questions) {
    const v = clean(q, answers[q.id]);
    if (q.required && !complete(q, v)) missing.push(q.id);
    if (v !== undefined) payload.push({ id: q.id, value: v });
  }
  if (missing.length) return res.status(400).json({ error: "missing", missing });

  const key = process.env.FILLOUT_API_KEY;
  if (!key) return res.status(503).json({ error: "not_configured" });

  try {
    const r = await fetch(`${API_BASE}/forms/${form.fillout.formId}/submissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        submissions: [{ questions: payload, submissionTime: new Date().toISOString() }],
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 500);
      console.error("Fillout rejected the submission", r.status, detail);
      return res.status(502).json({ error: "fillout", status: r.status, detail });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Could not reach Fillout", e);
    return res.status(502).json({ error: "unreachable" });
  }
};

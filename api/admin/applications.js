// /api/admin/applications            → list, with ?q= (search) &stage= (life stage) &role= (a role, full label)
// /api/admin/applications?id=123     → one application in full
// Signed-in admins only.

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { rolesQuestion } = require("../../lib/form");

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// the filter part of the query, shared with the export
function filters(query) {
  const q = String(query.q || "").trim().slice(0, 200);
  const stage = String(query.stage || "").slice(0, 200);
  const role = String(query.role || "").slice(0, 300);
  return {
    where: `($1 = '' or name ilike $2 or coalesce(telegram, '') ilike $2 or coalesce(phone, '') ilike $2
             or coalesce(school, '') ilike $2 or answers::text ilike $2)
        and ($3 = '' or life_stage = $3)
        and ($4 = '' or coalesce(answers -> $5, '{}'::jsonb) ? $4)`,
    params: [q, like(q), stage, role, rolesQuestion.id],
  };
}

async function handler(req, res) {
  if (!auth.requireAdmin(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  if (req.query.id !== undefined) {
    const id = Number(req.query.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "bad_request" });
    const [row] = await q(
      `select id, created_at, name, phone, telegram, dob::text as dob, life_stage, school, answers
         from applications where id = $1`,
      [id]
    );
    return row ? res.status(200).json({ application: row }) : res.status(404).json({ error: "not_found" });
  }

  const f = filters(req.query);
  const rows = await q(
    `select id, created_at, name, telegram, phone, life_stage, school, answers -> $6 as roles
       from applications
      where ${f.where}
      order by created_at desc
      limit 1000`,
    [...f.params, rolesQuestion.id]
  );
  const [{ total }] = await q(`select count(*)::int as total from applications`);
  return res.status(200).json({ applications: rows, total });
}

module.exports = handler;
module.exports.filters = filters;

// /api/admin/applications — admins only.
//   GET    ?q= (search) &stage= (life stage) &role= (a role, full label) &status=   → the list
//   GET    ?id=                                  → one application in full
//   PATCH  { id, status }                        → new / interviewing / accepted / declined
//   POST   { action: "accept", id }              → accept, and add them to the members directory

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { rolesQuestion } = require("../../lib/form");
const { log } = require("../../lib/activity");

const STATUSES = ["new", "interviewing", "accepted", "declined"];
const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// the filter part of the query, shared with the export
function filters(query) {
  const q = String(query.q || "").trim().slice(0, 200);
  const stage = String(query.stage || "").slice(0, 200);
  const role = String(query.role || "").slice(0, 300);
  const status = String(query.status || "").slice(0, 20);
  return {
    where: `($1 = '' or name ilike $2 or coalesce(telegram, '') ilike $2 or coalesce(phone, '') ilike $2
             or coalesce(school, '') ilike $2 or answers::text ilike $2)
        and ($3 = '' or life_stage = $3)
        and ($4 = '' or coalesce(answers -> $5, '{}'::jsonb) ? $4)
        and ($6 = '' or status = $6)`,
    params: [q, like(q), stage, role, rolesQuestion.id, status],
  };
}

async function handler(req, res) {
  const me = await auth.guard(req, res, ["master", "admin"]);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  if (req.method === "GET" && req.query.id !== undefined) {
    const id = idOf(req.query.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    const [row] = await q(
      `select id, created_at, name, phone, telegram, dob::text as dob, life_stage, school, answers, status, member_id
         from applications where id = $1`,
      [id]
    );
    return row ? res.status(200).json({ application: row, statuses: STATUSES }) : res.status(404).json({ error: "not_found" });
  }

  if (req.method === "GET") {
    const f = filters(req.query);
    const rows = await q(
      `select id, created_at, name, telegram, phone, life_stage, school, status, answers -> $7 as roles
         from applications
        where ${f.where}
        order by created_at desc
        limit 1000`,
      [...f.params, rolesQuestion.id]
    );
    const [{ total }] = await q(`select count(*)::int as total from applications`);
    return res.status(200).json({ applications: rows, total, statuses: STATUSES });
  }

  // privacy: delete applications (Master Admins). ?before=YYYY-MM-DD removes everyone who didn't join and
  // applied before that day (&dry=1 only counts them); ?id= removes one.
  if (req.method === "DELETE") {
    if (me.role !== "master") return res.status(403).json({ error: "not_allowed" });
    if (req.query.before !== undefined) {
      const before = String(req.query.before);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return res.status(400).json({ error: "bad_date" });
      const where = `member_id is null and created_at < $1::date`;
      if (req.query.dry === "1") {
        const [{ n }] = await q(`select count(*)::int as n from applications where ${where}`, [before]);
        return res.status(200).json({ count: n });
      }
      const gone = await q(`delete from applications where ${where} returning id`, [before]);
      await q(`delete from activity where kind = 'application' and ref_id = any($1::bigint[])`, [gone.map((g) => g.id)]);
      await log(q, me, "deleted", "application", null, `${gone.length} applications from before ${before}`);
      return res.status(200).json({ count: gone.length });
    }
    const one = idOf(req.query.id);
    const [gone] = one ? await q(`delete from applications where id = $1 returning id`, [one]) : [];
    if (!gone) return res.status(404).json({ error: "not_found" });
    await q(`delete from activity where kind = 'application' and ref_id = $1`, [one]);
    await log(q, me, "deleted", "application", null, "an application");
    return res.status(200).json({ ok: true });
  }

  const b = auth.body(req);
  const id = idOf(b.id);
  if (!id) return res.status(400).json({ error: "bad_request" });

  if (req.method === "PATCH") {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: "bad_status" });
    const [before] = await q(`select name, status from applications where id = $1`, [id]);
    if (!before) return res.status(404).json({ error: "not_found" });
    const [row] = await q(`update applications set status = $2 where id = $1 returning id, status`, [id, b.status]);
    if (before.status !== b.status) await log(q, me, "updated", "application", id, before.name, [{ field: "Status", from: before.status, to: b.status }]);
    return res.status(200).json({ application: row });
  }

  if (req.method === "POST" && b.action === "accept") {
    const [a] = await q(`select id, name, phone, telegram, dob, school, member_id from applications where id = $1`, [id]);
    if (!a) return res.status(404).json({ error: "not_found" });
    let memberId = a.member_id;
    const [linked] = memberId ? await q(`select id from members where id = $1`, [memberId]) : [];
    if (!linked) {
      [{ id: memberId }] = await q(
        `insert into members (name, telegram, phone, dob, school, joined_on, application_id)
         values ($1, $2, $3, $4, $5, current_date, $6) returning id`,
        [a.name, a.telegram, a.phone, a.dob, a.school, a.id]
      );
    }
    await q(`update applications set status = 'accepted', member_id = $2 where id = $1`, [id, memberId]);
    await log(q, me, "accepted", "application", id, a.name);
    await log(q, me, "created", "member", memberId, a.name, null, "Added from their application.");
    return res.status(200).json({ memberId: Number(memberId) });
  }

  res.setHeader("Allow", "GET, PATCH, POST, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
}

module.exports = handler;
module.exports.filters = filters;

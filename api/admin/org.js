// /api/admin/org — the org chart.
//   GET                                                   → units and everyone's seat and role     (everyone signed in)
//   POST   { kind, parent_id, name, code, overseers, note } → add a division, domain or team         (admins)
//   PATCH  { id, ...same fields }                          → edit one                               (admins)
//   DELETE ?id=                                            → remove an empty one                    (admins)
// Seating someone is done on their member record (unit_id, org_role).

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { ROLES, OVERSEER_ROLES, KINDS, PARENT_KINDS } = require("../../lib/org");

const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const unitOut = (u) => ({
  id: Number(u.id), kind: u.kind, parent_id: u.parent_id === null ? null : Number(u.parent_id),
  name: u.name, code: u.code, note: u.note, sort: u.sort,
  overseers: (u.overseers || []).map(Number),
});

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res, req.method === "GET" ? undefined : ["master", "admin"]);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  if (req.method === "GET") {
    const units = (await q(`select * from org_units order by sort, lower(coalesce(code, '')), lower(name)`)).map(unitOut);
    const people = (await q(
      `select id, name, title, org_role, unit_id, status from members where status <> 'alumni' order by lower(name)`
    )).map((p) => ({ ...p, id: Number(p.id), unit_id: p.unit_id === null ? null : Number(p.unit_id) }));
    return res.status(200).json({ units, people, roles: ROLES, overseerRoles: OVERSEER_ROLES });
  }

  const b = req.method === "DELETE" ? req.query : auth.body(req);

  if (req.method === "DELETE") {
    const id = idOf(b.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    const [{ kids }] = await q(`select count(*)::int as kids from org_units where parent_id = $1`, [id]);
    const [{ seated }] = await q(`select count(*)::int as seated from members where unit_id = $1`, [id]);
    if (kids || seated) return res.status(409).json({ error: "unit_not_empty" });
    const [row] = await q(`delete from org_units where id = $1 returning id`, [id]);
    return row ? res.status(200).json({ ok: true }) : res.status(404).json({ error: "not_found" });
  }

  // POST and PATCH share the checks
  let current = null;
  if (req.method === "PATCH") {
    const id = idOf(b.id);
    [current] = id ? await q(`select * from org_units where id = $1`, [id]) : [];
    if (!current) return res.status(404).json({ error: "not_found" });
  } else if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const kind = current ? current.kind : String(b.kind || "");
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "bad_kind" });

  const v = {};
  if (!current || "name" in b) {
    v.name = clip(b.name, 100);
    if (!v.name) return res.status(400).json({ error: "name_required" });
  }
  if (!current || "code" in b) v.code = clip(b.code, 16) || null;
  if (!current || "note" in b) v.note = clip(b.note, 1000) || null;

  if (!current || "parent_id" in b) {
    const parentId = b.parent_id === null || b.parent_id === "" || b.parent_id === undefined ? null : idOf(b.parent_id);
    const [parent] = parentId ? await q(`select id, kind from org_units where id = $1`, [parentId]) : [];
    if (parentId && !parent) return res.status(400).json({ error: "bad_parent" });
    if (!PARENT_KINDS[kind].includes(parent ? parent.kind : null)) return res.status(400).json({ error: "bad_parent" });
    v.parent_id = parentId;
  }

  if ("overseers" in b) {
    const ids = [...new Set((Array.isArray(b.overseers) ? b.overseers : []).map(idOf).filter(Boolean))];
    if (ids.length) {
      const found = await q(`select id from members where id = any($1::bigint[]) and org_role = any($2::text[])`, [ids, OVERSEER_ROLES]);
      if (found.length !== ids.length) return res.status(400).json({ error: "bad_overseer" });
    }
    v.overseers = ids;
  } else if (!current) {
    v.overseers = [];
  }

  const keys = Object.keys(v);
  const cast = (k) => (k === "overseers" ? "::bigint[]" : "");
  if (!current) {
    const [{ next }] = await q(`select coalesce(max(sort), -1) + 1 as next from org_units`);
    const [row] = await q(
      `insert into org_units (kind, sort, ${keys.join(", ")}) values ($1, $2, ${keys.map((k, i) => `$${i + 3}${cast(k)}`).join(", ")}) returning *`,
      [kind, next, ...keys.map((k) => v[k])]
    );
    return res.status(201).json({ unit: unitOut(row) });
  }
  if (!keys.length) return res.status(400).json({ error: "nothing_to_change" });
  const [row] = await q(
    `update org_units set ${keys.map((k, i) => `${k} = $${i + 2}${cast(k)}`).join(", ")}, updated_at = now() where id = $1 returning *`,
    [current.id, ...keys.map((k) => v[k])]
  );
  return res.status(200).json({ unit: unitOut(row) });
};

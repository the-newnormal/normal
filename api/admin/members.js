// /api/admin/members — the Normal members directory.
//   GET    ?q= &unit= &status=     → the directory (unit: a division, domain or team, and everything under it)
//   GET    ?id=                    → one profile
//   GET    ?format=csv             → the directory as a spreadsheet        (admins)
//   POST   { name, ...fields }     → add someone                           (admins)
//   PATCH  { id, ...fields }       → edit                                  (admins; members only their own contact details)
//   DELETE ?id=                    → remove                                (admins)
//
// Members see each other's name, title, role, seat on the org chart and Telegram only. Phone, email,
// birthday, school and notes stay with admins (and each member sees their own, minus notes).

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { ROLES } = require("../../lib/org");

const STATUSES = ["active", "on break", "alumni"];
const FIELDS = ["name", "title", "org_role", "unit_id", "telegram", "phone", "email", "dob", "school", "joined_on", "status", "notes"];
const OWN_FIELDS = ["telegram", "phone", "email", "dob", "school"]; // what members can change on their own profile
const LIMITS = { name: 120, title: 120, telegram: 64, phone: 32, email: 160, school: 160, notes: 4000 };

const SEAT = `m.org_role, m.unit_id, u.code as unit_code, u.name as unit_name, u.kind as unit_kind`;
const PUBLIC_COLS = `m.id, m.name, m.title, ${SEAT}, m.telegram, m.status`;
const FULL_COLS = `m.id, m.name, m.title, ${SEAT}, m.telegram, m.phone, m.email, m.dob::text as dob, m.school,
                   m.joined_on::text as joined_on, m.status, m.notes, m.application_id, m.created_at, m.updated_at,
                   a.username as login, a.role as login_role`;
const OWN_COLS = `m.id, m.name, m.title, ${SEAT}, m.telegram, m.phone, m.email, m.dob::text as dob, m.school,
                  m.joined_on::text as joined_on, m.status`;
const FROM = `members m left join accounts a on a.member_id = m.id left join org_units u on u.id = m.unit_id`;

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const isAdmin = (u) => u.role === "master" || u.role === "admin";

// → { values } or { error }
async function clean(q, input, allowed) {
  const values = {};
  for (const f of allowed) {
    if (!(f in input)) continue;
    let v = input[f] === null || input[f] === undefined ? "" : String(input[f]).trim();
    if (f === "dob" || f === "joined_on") {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: `bad_${f}` };
    } else if (f === "status") {
      v = v.toLowerCase() || "active";
      if (!STATUSES.includes(v)) return { error: "bad_status" };
    } else if (f === "email") {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: "bad_email" };
    } else if (f === "org_role") {
      if (v && !ROLES.includes(v)) return { error: "bad_role" };
    } else if (f === "unit_id") {
      if (v) {
        const id = idOf(v);
        const [u] = id ? await q(`select id from org_units where id = $1`, [id]) : [];
        if (!u) return { error: "bad_unit" };
        v = id;
      }
    }
    if (LIMITS[f]) v = v.slice(0, LIMITS[f]);
    values[f] = v === "" ? null : v;
  }
  if ("name" in values && !values.name) return { error: "name_required" };
  return { values };
}

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });
  const admin = isAdmin(me);

  if (req.method === "GET" && req.query.id !== undefined) {
    const id = idOf(req.query.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    const cols = admin ? FULL_COLS : id === me.memberId ? OWN_COLS : PUBLIC_COLS;
    const [m] = await q(`select ${cols} from ${FROM} where m.id = $1`, [id]);
    return m ? res.status(200).json({ member: m, canEdit: admin ? FIELDS : id === me.memberId ? OWN_FIELDS : [], roles: ROLES })
             : res.status(404).json({ error: "not_found" });
  }

  if (req.method === "GET") {
    const text = String(req.query.q || "").trim().slice(0, 200);
    const unit = String(idOf(req.query.unit) || "");
    const status = String(req.query.status || "").slice(0, 20);
    const shared = `m.name ilike $2 or coalesce(m.title,'') ilike $2 or coalesce(m.org_role,'') ilike $2
                    or coalesce(u.name,'') ilike $2 or coalesce(u.code,'') ilike $2 or coalesce(m.telegram,'') ilike $2`;
    const searchable = admin ? `${shared} or coalesce(m.school,'') ilike $2 or coalesce(m.email,'') ilike $2 or coalesce(m.phone,'') ilike $2` : shared;
    const where = `($1 = '' or ${searchable})
      and ($3 = '' or m.unit_id in (with recursive t(id) as (
            select nullif($3, '')::bigint union all select o.id from org_units o join t on o.parent_id = t.id
          ) select id from t))
      and ($4 = '' or m.status = $4)`;
    const params = [text, like(text), unit, status];

    if (req.query.format === "csv") {
      if (!admin) return res.status(403).json({ error: "not_allowed" });
      const rows = await q(`select ${FULL_COLS} from ${FROM} where ${where} order by lower(m.name)`, params);
      const cols = ["name", "title", "org_role", "seat", "telegram", "phone", "email", "dob", "school", "joined_on", "status", "notes", "login"];
      const seat = (r) => [r.unit_code, r.unit_name].filter(Boolean).join(" ");
      const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(c === "seat" ? seat(r) : r[c])).join(","))];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="normal-members-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("﻿" + lines.join("\r\n"));
    }

    const members = await q(
      `select ${admin ? FULL_COLS : PUBLIC_COLS} from ${FROM}
        where ${where} order by (m.status = 'active') desc, lower(m.name) limit 2000`,
      params
    );
    const [{ total }] = await q(`select count(*)::int as total from members`);
    return res.status(200).json({ members, total, statuses: STATUSES, roles: ROLES });
  }

  const b = auth.body(req);

  if (req.method === "POST") {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const c = await clean(q, { status: "active", ...b }, FIELDS);
    if (c.error) return res.status(400).json({ error: c.error });
    if (!c.values.name) return res.status(400).json({ error: "name_required" });
    const keys = Object.keys(c.values);
    const [m] = await q(
      `insert into members (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      keys.map((k) => c.values[k])
    );
    return res.status(201).json({ id: Number(m.id) });
  }

  if (req.method === "PATCH") {
    const id = idOf(b.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    if (!admin && id !== me.memberId) return res.status(403).json({ error: "not_allowed" });
    const allowed = admin ? FIELDS : OWN_FIELDS;
    const c = await clean(q, b, allowed);
    if (c.error) return res.status(400).json({ error: c.error });
    const keys = Object.keys(c.values);
    if (!keys.length) return res.status(400).json({ error: "nothing_to_change" });
    const [m] = await q(
      `update members set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning id`,
      [id, ...keys.map((k) => c.values[k])]
    );
    return m ? res.status(200).json({ ok: true }) : res.status(404).json({ error: "not_found" });
  }

  if (req.method === "DELETE") {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const id = idOf(req.query.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    await q(`update accounts set member_id = null where member_id = $1`, [id]);
    await q(`update applications set member_id = null where member_id = $1`, [id]);
    await q(`update org_units set overseers = array_remove(overseers, $1::bigint) where $1::bigint = any(overseers)`, [id]);
    const [m] = await q(`delete from members where id = $1 returning id`, [id]);
    return m ? res.status(200).json({ ok: true }) : res.status(404).json({ error: "not_found" });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

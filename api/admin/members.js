// /api/admin/members — the Normal members directory.
//   GET    ?q= &unit= &status=     → the directory (unit: a division, domain or team, and everything under it)
//   GET    ?id=                    → one profile
//   GET    ?format=csv             → the directory as a spreadsheet                  (admins)
//   POST   { name, ...fields }     → add someone                                     (admins)
//   PATCH  { id, ...fields }       → edit                                            (admins; members only their own contact details)
//   PATCH  { id, seats: [...] }    → replace their seats: [{ unit_id|null, role, note }]   (admins)
//   DELETE ?id=                    → remove                                          (admins)
//
// Members see each other's name, title, seats (role and unit) and Telegram only. Phone, email, birthday,
// school, round, seat notes and notes stay with admins (each member sees their own, minus notes),
// and members see "joining" instead of whether a recruit is leaning in or leaning no.

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { ROLES, STATUSES, LEANING, publicStatus, topRole } = require("../../lib/org");
const { log, diff } = require("../../lib/activity");
const LABELS = { name: "Name", title: "Title", round: "Round", telegram: "Telegram", phone: "Phone", email: "Email", dob: "Birthday",
  school: "School", joined_on: "Joined", status: "Status", notes: "Notes" };

const FIELDS = ["name", "title", "round", "telegram", "phone", "email", "dob", "school", "joined_on", "status", "notes"];
const OWN_FIELDS = ["telegram", "phone", "email", "dob", "school"]; // what members can change on their own profile
const LIMITS = { name: 120, title: 120, round: 80, telegram: 64, phone: 32, email: 160, school: 160, notes: 4000 };
const MAX_SEATS = 10;

const seatsCol = (withNotes) => `coalesce((
    select json_agg(json_build_object('unit_id', s.unit_id, 'role', s.role, 'unit_code', u.code, 'unit_name', u.name, 'unit_kind', u.kind${withNotes ? ", 'note', s.note" : ""})
           order by s.sort, s.id)
      from seats s left join org_units u on u.id = s.unit_id where s.member_id = m.id), '[]'::json) as seats`;
const PUBLIC_COLS = `m.id, m.name, m.title, m.telegram, m.status, ${seatsCol(false)}`;
const FULL_COLS = `m.id, m.name, m.title, m.round, m.telegram, m.phone, m.email, m.dob::text as dob, m.school,
                   m.joined_on::text as joined_on, m.status, m.notes, m.application_id, m.created_at, m.updated_at,
                   a.username as login, a.role as login_role, ${seatsCol(true)}`;
const OWN_COLS = `m.id, m.name, m.title, m.telegram, m.phone, m.email, m.dob::text as dob, m.school,
                  m.joined_on::text as joined_on, m.status, ${seatsCol(false)}`;
const FROM = `members m left join accounts a on a.member_id = m.id`;

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const isAdmin = (u) => u.role === "master" || u.role === "admin";
const parseSeats = (s) => (typeof s === "string" ? JSON.parse(s) : s || []);

// adds org_role (their highest role) and hides what members shouldn't see
function shape(m, admin) {
  const seats = parseSeats(m.seats).map((s) => ({ ...s, unit_id: s.unit_id === null ? null : Number(s.unit_id) }));
  return { ...m, seats, org_role: topRole(seats), status: admin ? m.status : publicStatus(m.status) };
}

// → { values } or { error }
function clean(input, allowed) {
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
    }
    if (LIMITS[f]) v = v.slice(0, LIMITS[f]);
    values[f] = v === "" ? null : v;
  }
  if ("name" in values && !values.name) return { error: "name_required" };
  return { values };
}

async function cleanSeats(q, input) {
  if (!Array.isArray(input) || input.length > MAX_SEATS) return { error: "bad_seats" };
  const seats = [];
  for (const s of input) {
    const role = String((s && s.role) || "Member");
    if (!ROLES.includes(role)) return { error: "bad_role" };
    const unitId = s && s.unit_id !== null && s.unit_id !== "" && s.unit_id !== undefined ? idOf(s.unit_id) : null;
    if (s && s.unit_id && !unitId) return { error: "bad_unit" };
    seats.push({ unit_id: unitId, role, note: String((s && s.note) || "").trim().slice(0, 300) || null });
  }
  const ids = [...new Set(seats.map((s) => s.unit_id).filter(Boolean))];
  if (ids.length) {
    const found = await q(`select id from org_units where id = any($1::bigint[])`, [ids]);
    if (found.length !== ids.length) return { error: "bad_unit" };
  }
  return { seats };
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
    return m ? res.status(200).json({ member: shape(m, admin), canEdit: admin ? FIELDS : id === me.memberId ? OWN_FIELDS : [], canSeat: admin, roles: ROLES, statuses: STATUSES })
             : res.status(404).json({ error: "not_found" });
  }

  if (req.method === "GET") {
    const text = String(req.query.q || "").trim().slice(0, 200);
    const unit = String(idOf(req.query.unit) || "");
    let status = String(req.query.status || "").slice(0, 20);
    if (!admin && LEANING.includes(status)) status = "-"; // members can't pick out who is leaning which way
    const seatSearch = `exists (select 1 from seats s left join org_units u on u.id = s.unit_id
                         where s.member_id = m.id and (s.role ilike $2 or coalesce(u.name,'') ilike $2 or coalesce(u.code,'') ilike $2))`;
    const shared = `m.name ilike $2 or coalesce(m.title,'') ilike $2 or coalesce(m.telegram,'') ilike $2 or ${seatSearch}`;
    const searchable = admin
      ? `${shared} or coalesce(m.school,'') ilike $2 or coalesce(m.email,'') ilike $2 or coalesce(m.phone,'') ilike $2 or coalesce(m.round,'') ilike $2`
      : shared;
    // members filter tentative recruits as "joining"
    const statusMatch = `($4 = '' or m.status = $4 or ($4 = 'joining' and m.status = any($5::text[])))`;
    const where = `($1 = '' or ${searchable})
      and ($3 = '' or exists (select 1 from seats s where s.member_id = m.id and s.unit_id in (with recursive t(id) as (
            select nullif($3, '')::bigint union all select o.id from org_units o join t on o.parent_id = t.id
          ) select id from t)))
      and ${statusMatch}`;
    const params = [text, like(text), unit, status, LEANING];

    if (req.query.format === "csv") {
      if (!admin) return res.status(403).json({ error: "not_allowed" });
      const rows = (await q(`select ${FULL_COLS} from ${FROM} where ${where} order by lower(m.name)`, params)).map((m) => shape(m, true));
      const cols = ["name", "title", "org_role", "seats", "round", "telegram", "phone", "email", "dob", "school", "joined_on", "status", "notes", "login"];
      const seatText = (r) => r.seats.map((s) => `${s.role}${s.unit_id ? " · " + [s.unit_code, s.unit_name].filter(Boolean).join(" ") : " · Normal"}`).join("; ");
      const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(c === "seats" ? seatText(r) : r[c])).join(","))];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="normal-members-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("﻿" + lines.join("\r\n"));
    }

    const members = (await q(
      `select ${admin ? FULL_COLS : PUBLIC_COLS} from ${FROM}
        where ${where} order by (m.status = 'active') desc, lower(m.name) limit 2000`,
      params
    )).map((m) => shape(m, admin));
    const [{ total }] = await q(`select count(*)::int as total from members`);
    return res.status(200).json({ members, total, statuses: admin ? STATUSES : ["active", "joining", "on break", "alumni"], roles: ROLES });
  }

  const b = auth.body(req);

  if (req.method === "POST") {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const c = clean({ status: "active", ...b }, FIELDS);
    if (c.error) return res.status(400).json({ error: c.error });
    if (!c.values.name) return res.status(400).json({ error: "name_required" });
    const keys = Object.keys(c.values);
    const [m] = await q(
      `insert into members (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      keys.map((k) => c.values[k])
    );
    await log(q, me, "created", "member", m.id, c.values.name);
    return res.status(201).json({ id: Number(m.id) });
  }

  if (req.method === "PATCH" && "seats" in b) {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const id = idOf(b.id);
    const [m] = id ? await q(`select id, name, ${seatsCol(false)} from members m where id = $1`, [id]) : [];
    if (!m) return res.status(404).json({ error: "not_found" });
    const c = await cleanSeats(q, b.seats);
    if (c.error) return res.status(400).json({ error: c.error });
    await q(`delete from seats where member_id = $1`, [id]);
    if (c.seats.length) {
      await q(
        `insert into seats (member_id, unit_id, role, note, sort)
         select $1, x.unit_id, x.role, x.note, x.sort from json_to_recordset($2::json) as x(unit_id bigint, role text, note text, sort int)`,
        [id, JSON.stringify(c.seats.map((s, i) => ({ ...s, sort: i })))]
      );
    }
    await q(`update members set updated_at = now() where id = $1`, [id]);
    const [after] = await q(`select ${seatsCol(false)} from members m where id = $1`, [id]);
    const seatText = (seats) => parseSeats(seats).map((s) => `${s.role} · ${s.unit_id ? [s.unit_code, s.unit_name].filter(Boolean).join(" ") : "Normal"}`).join("; ") || null;
    const changes = diff({ seats: seatText(m.seats) }, { seats: seatText(after.seats) }, { seats: "Seats" });
    if (changes.length) await log(q, me, "updated", "member", id, m.name, changes);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PATCH") {
    const id = idOf(b.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    if (!admin && id !== me.memberId) return res.status(403).json({ error: "not_allowed" });
    const c = clean(b, admin ? FIELDS : OWN_FIELDS);
    if (c.error) return res.status(400).json({ error: c.error });
    const keys = Object.keys(c.values);
    if (!keys.length) return res.status(400).json({ error: "nothing_to_change" });
    const [before] = await q(`select name, title, round, telegram, phone, email, dob::text as dob, school, joined_on::text as joined_on, status, notes from members where id = $1`, [id]);
    if (!before) return res.status(404).json({ error: "not_found" });
    await q(
      `update members set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`,
      [id, ...keys.map((k) => c.values[k])]
    );
    const changes = diff(before, c.values, LABELS);
    if (changes.length) await log(q, me, "updated", "member", id, c.values.name || before.name, changes);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const id = idOf(req.query.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    await q(`update accounts set member_id = null where member_id = $1`, [id]);
    await q(`update applications set member_id = null where member_id = $1`, [id]);
    await q(`update org_units set overseers = array_remove(overseers, $1::bigint) where $1::bigint = any(overseers)`, [id]);
    await q(`delete from seats where member_id = $1`, [id]);
    const [m] = await q(`delete from members where id = $1 returning id, name`, [id]);
    if (!m) return res.status(404).json({ error: "not_found" });
    // their notes go with them, and the log stops naming them
    await q(`delete from activity where kind = 'member' and ref_id = $1 and action = 'note'`, [id]);
    await q(`update activity set label = '(deleted member)', changes = null where kind = 'member' and ref_id = $1`, [id]);
    await log(q, me, "deleted", "member", null, "a member record");
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

// /api/admin/org — the org chart.
//   GET                                                   → units, people and seats                (everyone signed in)
//   POST   { kind, parent_id, name, code, overseers, note } → add a division, domain or team         (admins)
//   POST   { action: "import", units, people }            → load a Team Map export                 (admins)
//   PATCH  { id, ...same fields, manages? }                → edit one; manages: the modules it looks after (admins)
//   DELETE ?id=                                            → remove an empty one                    (admins)
// Seating someone by hand is done on their member record.

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { ROLES, OVERSEER_ROLES, KINDS, PARENT_KINDS, STATUSES, publicStatus } = require("../../lib/org");
const { log } = require("../../lib/activity");
const R = require("../../lib/records");

const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const unitOut = (u) => ({
  id: Number(u.id), kind: u.kind, parent_id: num(u.parent_id),
  name: u.name, code: u.code, note: u.note, sort: u.sort,
  overseers: (u.overseers || []).map(Number),
});

// A Team Map export, already read into rows by the portal (admin/teammap.js):
//   units:  [{ key, kind, name, code, parent }]   parents come before their children; parent is a key or null
//   people: [{ name, round, status, note, seats: [{ unit, role, note }] }]   unit is a key or null (the top)
// People are matched by name and units by name under the same parent: new ones are added, existing ones kept.
// Everyone in the file gets the file's status, round and seats.
async function importTeamMap(q, b) {
  const units = Array.isArray(b.units) ? b.units : [];
  const people = Array.isArray(b.people) ? b.people : [];
  if (units.length > 1000 || people.length > 3000 || !people.length) return [400, { error: "bad_import" }];

  // units, a level at a time so parents get their ids first
  const existing = (await q(`select id, kind, parent_id, name from org_units`)).map((u) => ({ ...u, id: Number(u.id), parent_id: num(u.parent_id) }));
  const find = (kind, parentId, name) => existing.find((u) => u.kind === kind && u.parent_id === parentId && u.name.toLowerCase() === name.toLowerCase());
  const idByKey = new Map();
  let unitsAdded = 0;
  const [{ sort0 }] = await q(`select coalesce(max(sort), -1) + 1 as sort0 from org_units`);
  for (const kind of KINDS) {
    const fresh = [];
    for (const u of units.filter((x) => x && x.kind === kind)) {
      const name = clip(u.name, 100);
      if (!name || typeof u.key !== "string") return [400, { error: "bad_import" }];
      const parentId = u.parent === null || u.parent === undefined ? null : idByKey.get(u.parent);
      if (parentId === undefined) return [400, { error: "bad_import" }];
      const parent = parentId === null ? null : existing.find((x) => x.id === parentId);
      if (!PARENT_KINDS[kind].includes(parent ? parent.kind : null)) return [400, { error: "bad_import" }];
      const hit = find(kind, parentId, name);
      if (hit) idByKey.set(u.key, hit.id);
      else fresh.push({ key: u.key, kind, parent_id: parentId, name, code: clip(u.code, 16) || null, sort: sort0 + unitsAdded + fresh.length });
    }
    if (!fresh.length) continue;
    const made = await q(
      `insert into org_units (kind, parent_id, name, code, sort)
       select x.kind, x.parent_id, x.name, x.code, x.sort from json_to_recordset($1::json) as x(kind text, parent_id bigint, name text, code text, sort int)
       returning id, kind, parent_id, name`,
      [JSON.stringify(fresh)]
    );
    for (const row of made) {
      const u = { ...row, id: Number(row.id), parent_id: num(row.parent_id) };
      existing.push(u);
      const f = fresh.find((x) => x.kind === u.kind && x.parent_id === u.parent_id && x.name === u.name);
      if (f) idByKey.set(f.key, u.id);
    }
    unitsAdded += fresh.length;
  }

  // people
  const clean = [];
  for (const p of people) {
    const name = clip(p && p.name, 120);
    if (!name) continue;
    const status = STATUSES.includes(p.status) ? p.status : "active";
    const seats = (Array.isArray(p.seats) ? p.seats : []).slice(0, 10).map((s, i) => ({
      unit_id: s.unit === null || s.unit === undefined ? null : idByKey.get(s.unit) ?? -1,
      role: ROLES.includes(s.role) ? s.role : "Member",
      note: clip(s.note, 300) || null,
      sort: i,
    }));
    if (seats.some((s) => s.unit_id === -1)) return [400, { error: "bad_import" }];
    clean.push({ name, round: clip(p.round, 80) || null, status, note: clip(p.note, 1000) || null, seats });
  }
  const known = new Map();
  for (const m of await q(`select id, name from members order by id`)) {
    const k = m.name.toLowerCase();
    if (!known.has(k)) known.set(k, Number(m.id));
  }
  const fresh = clean.filter((p) => !known.has(p.name.toLowerCase()));
  const old = clean.filter((p) => known.has(p.name.toLowerCase())).map((p) => ({ ...p, id: known.get(p.name.toLowerCase()) }));
  if (fresh.length) {
    const made = await q(
      `insert into members (name, round, status, notes)
       select x.name, x.round, x.status, x.note from json_to_recordset($1::json) as x(name text, round text, status text, note text)
       returning id, name`,
      [JSON.stringify(fresh)]
    );
    for (const m of made) known.set(m.name.toLowerCase(), Number(m.id));
  }
  if (old.length) {
    await q(
      `update members m set round = coalesce(x.round, m.round), status = x.status,
              notes = coalesce(m.notes, x.note), updated_at = now()
         from json_to_recordset($1::json) as x(id bigint, round text, status text, note text)
        where m.id = x.id`,
      [JSON.stringify(old)]
    );
  }

  // seats: everyone in the file sits exactly where the file says
  const ids = clean.map((p) => known.get(p.name.toLowerCase()));
  await q(`delete from seats where member_id = any($1::bigint[])`, [ids]);
  const seatRows = clean.flatMap((p) => p.seats.map((s) => ({ ...s, member_id: known.get(p.name.toLowerCase()) })));
  if (seatRows.length) {
    await q(
      `insert into seats (member_id, unit_id, role, note, sort)
       select x.member_id, x.unit_id, x.role, x.note, x.sort from json_to_recordset($1::json) as x(member_id bigint, unit_id bigint, role text, note text, sort int)`,
      [JSON.stringify(seatRows)]
    );
  }
  return [200, { unitsAdded, peopleAdded: fresh.length, peopleUpdated: old.length, seats: seatRows.length }];
}

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res, req.method === "GET" ? undefined : ["master", "admin"]);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });
  const admin = me.role === "master" || me.role === "admin";

  if (req.method === "GET") {
    const units = (await q(`select * from org_units order by sort, lower(coalesce(code, '')), lower(name)`)).map(unitOut);
    const people = (await q(`select id, name, title, status from members where status <> 'alumni' order by lower(name)`))
      .map((p) => ({ ...p, id: Number(p.id), status: admin ? p.status : publicStatus(p.status) }));
    const seats = (await q(
      `select s.member_id, s.unit_id, s.role, s.note from seats s join members m on m.id = s.member_id
        where m.status <> 'alumni' order by s.sort, s.id`
    )).map((s) => ({ member_id: Number(s.member_id), unit_id: num(s.unit_id), role: s.role, ...(admin && s.note ? { note: s.note } : {}) }));
    return res.status(200).json({ units, people, seats, roles: ROLES, overseerRoles: OVERSEER_ROLES, managers: await R.managerUnits(q), managerGroups: R.MANAGER_GROUPS });
  }

  const b = req.method === "DELETE" ? req.query : auth.body(req);

  if (req.method === "POST" && b.action === "import") {
    const [status, out] = await importTeamMap(q, b);
    if (status === 200) await log(q, me, "imported", "import", null, "the Team Map", [
      { field: "People added", from: null, to: String(out.peopleAdded) }, { field: "People updated", from: null, to: String(out.peopleUpdated) },
      { field: "Divisions, domains and teams added", from: null, to: String(out.unitsAdded) }]);
    return res.status(status).json(out);
  }

  if (req.method === "DELETE") {
    const id = idOf(b.id);
    if (!id) return res.status(400).json({ error: "bad_request" });
    const [{ kids }] = await q(`select count(*)::int as kids from org_units where parent_id = $1`, [id]);
    const [{ seated }] = await q(`select count(*)::int as seated from seats where unit_id = $1`, [id]);
    if (kids || seated) return res.status(409).json({ error: "unit_not_empty" });
    const [row] = await q(`delete from org_units where id = $1 returning id, name`, [id]);
    if (!row) return res.status(404).json({ error: "not_found" });
    await log(q, me, "deleted", "unit", id, row.name);
    return res.status(200).json({ ok: true });
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
      const found = await q(`select distinct member_id from seats where member_id = any($1::bigint[]) and role = any($2::text[])`, [ids, OVERSEER_ROLES]);
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
    await log(q, me, "created", "unit", row.id, row.name, [{ field: "Kind", from: null, to: kind }]);
    return res.status(201).json({ unit: unitOut(row) });
  }
  if (!keys.length && !Array.isArray(b.manages)) return res.status(400).json({ error: "nothing_to_change" });
  const [row] = keys.length ? await q(
    `update org_units set ${keys.map((k, i) => `${k} = $${i + 2}${cast(k)}`).join(", ")}, updated_at = now() where id = $1 returning *`,
    [current.id, ...keys.map((k) => v[k])]
  ) : [current];
  const changes = ["name", "code", "parent_id", "note"].filter((k) => k in v && (v[k] ?? null) !== (k === "parent_id" ? (current[k] === null ? null : Number(current[k])) : current[k] ?? null))
    .map((k) => ({ field: { name: "Name", code: "Code", parent_id: "Sits under", note: "Note" }[k], from: k === "parent_id" ? null : current[k], to: k === "parent_id" ? "moved" : v[k] }));
  if ("overseers" in v && JSON.stringify(v.overseers) !== JSON.stringify((current.overseers || []).map(Number))) changes.push({ field: "Overseen by", from: null, to: "changed" });
  // the modules this unit looks after (one unit each): ticking moves it here, unticking clears it
  if (Array.isArray(b.manages)) {
    const now = await R.managerUnits(q);
    for (const g of R.MANAGER_GROUPS) {
      const want = b.manages.includes(g.key), has = now[g.key] === Number(current.id);
      if (want && !has) await q(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [`managers:${g.key}`, String(current.id)]);
      if (!want && has) await q(`delete from settings where key = $1`, [`managers:${g.key}`]);
      if (want !== has) changes.push({ field: g.label, from: has ? "yes" : "no", to: want ? "yes" : "no" });
    }
  }
  if (changes.length) await log(q, me, "updated", "unit", current.id, row.name, changes);
  return res.status(200).json({ unit: unitOut(row) });
};

// /api/admin/records — every module defined in lib/collections.js (tasks, events & projects, meetings,
// partners, finance, library, announcements).
//   GET    ?schema=1                                   → the modules this person can open, and their fields
//   GET    ?c=tasks [&q=] [&f.<field>=] [&mine=1] [&sort=&dir=] [&archived=1]   → a list
//   GET    ?c=tasks&lite=1                             → id + title of every record (for pickers)
//   GET    ?c=tasks&id=                                → one record
//   GET    ?c=tasks&format=csv                         → the list as a spreadsheet       (admins)
//   POST   { c, data }                                 → add a record
//   PATCH  { c, id, data }                             → change fields
//   PATCH  { c, id, archived: true|false }             → archive or restore            (admins)
//   DELETE ?c=&id=                                     → delete for good               (admins)
// Who sees and changes what is set per module in lib/collections.js; this enforces it.

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { log, diff } = require("../../lib/activity");
const R = require("../../lib/records");

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });
  const admin = R.isAdmin(me);

  if (req.method === "GET" && req.query.schema !== undefined) {
    return res.status(200).json({ collections: R.schemaFor(me) });
  }

  const b = req.method === "GET" || req.method === "DELETE" ? req.query : auth.body(req);
  const c = String(b.c || "");
  if (!R.canOpen(me, c)) return res.status(R.COLLECTIONS[c] ? 403 : 404).json({ error: R.COLLECTIONS[c] ? "not_allowed" : "not_found" });
  const cfg = R.COLLECTIONS[c];
  const labels = Object.fromEntries(cfg.fields.map((f) => [f.key, f.label]));

  // builds the parameter list as the query is written
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  async function loadOne(id) {
    params.length = 0;
    const [row] = await q(`select * from records where collection = ${p(c)} and id = ${p(id)} and ${R.visibleSql(me, c, p)}`, params);
    return row || null;
  }

  if (req.method === "GET" && b.id !== undefined) {
    const id = R.idOf(b.id);
    const row = id ? await loadOne(id) : null;
    if (!row) return res.status(404).json({ error: "not_found" });
    const refs = await R.refsFor(q, c, [row]);
    return res.status(200).json({ record: R.rowOut(c, row), refs, canEdit: row.archived ? [] : R.editableFields(me, c, row.data), canManage: admin });
  }

  if (req.method === "GET") {
    const where = [`collection = ${p(c)}`, R.visibleSql(me, c, p)];
    if (b.lite === undefined) where.push(`archived = ${p(b.archived === "1")}`);
    else where.push("archived = false");
    const text = String(b.q || "").trim().slice(0, 200);
    if (text) where.push(`data::text ilike ${p(like(text))}`);
    for (const f of cfg.fields) {
      const v = b[`f.${f.key}`];
      if (v === undefined || v === "" || !f.filter || !R.KEY_RE.test(f.key)) continue;
      if (f.type === "members") where.push(`coalesce(data->'${f.key}', '[]'::jsonb) @> jsonb_build_array(${p(R.idOf(v) || 0)}::bigint)`);
      else if (f.type === "unit") {
        where.push(`(data->>'${f.key}')::bigint in (with recursive t(id) as (select ${p(R.idOf(v) || 0)}::bigint union all
                     select o.id from org_units o join t on o.parent_id = t.id) select id from t)`);
      } else where.push(`coalesce(data->>'${f.key}', '') = ${p(String(v))}`);
    }
    if (b.mine === "1") {
      const mine = cfg.fields.filter((f) => f.type === "member" || f.type === "members").map((f) =>
        f.type === "members" ? `coalesce(data->'${f.key}', '[]'::jsonb) @> jsonb_build_array(${p(me.memberId || 0)}::bigint)` : `data->>'${f.key}' = ${p(String(me.memberId || 0))}`);
      where.push(mine.length ? `(${mine.join(" or ")})` : "false");
    }
    if (b.open === "1" && cfg.done && R.KEY_RE.test(cfg.done.field)) where.push(`coalesce(data->>'${cfg.done.field}', '') <> all(${p(cfg.done.values)}::text[])`);

    if (b.lite !== undefined) {
      const rows = await q(`select id, seq, data from records where ${where.join(" and ")} order by lower(data->>'${cfg.title}')`, params);
      return res.status(200).json({ records: rows.map((r) => ({ id: Number(r.id), code: R.code(c, r.seq), title: R.titleOf(c, r.data) })) });
    }

    const sortKey = cfg.fields.some((f) => f.key === b.sort) ? b.sort : cfg.sort[0];
    const dir = (b.dir || (sortKey === cfg.sort[0] ? cfg.sort[1] : "asc")) === "desc" ? "desc" : "asc";
    const sf = R.fieldOf(c, sortKey);
    const sortExpr = sf && (sf.type === "number" || sf.type === "money") ? `(data->>'${sortKey}')::numeric` : `lower(data->>'${sortKey}')`;
    const rows = await q(
      `select * from records where ${where.join(" and ")} order by ${sortExpr} ${dir} nulls last, seq desc limit 2000`,
      params
    );
    const refs = await R.refsFor(q, c, rows);

    if (b.format === "csv") {
      if (!admin) return res.status(403).json({ error: "not_allowed" });
      const head = ["id", ...cfg.fields.map((f) => f.label), "created", "updated"];
      const lines = [head.map(cell).join(",")];
      for (const r of rows) {
        lines.push([R.code(c, r.seq), ...cfg.fields.map((f) => R.display(c, f.key, r.data[f.key], refs) ?? ""),
          new Date(r.created_at).toISOString().slice(0, 10), new Date(r.updated_at).toISOString().slice(0, 10)].map(cell).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="normal-${c}-${R.todaySG()}.csv"`);
      return res.status(200).send("﻿" + lines.join("\r\n"));
    }

    params.length = 0;
    const [{ total }] = await q(`select count(*)::int as total from records where collection = ${p(c)} and archived = ${p(b.archived === "1")} and ${R.visibleSql(me, c, p)}`, params);
    return res.status(200).json({ records: rows.map((r) => R.rowOut(c, r)), refs, total });
  }

  if (req.method === "POST") {
    const schema = R.schemaFor(me)[c];
    if (!schema.canCreate) return res.status(403).json({ error: "not_allowed" });
    const input = { ...schema.defaults, ...(b.data && typeof b.data === "object" ? b.data : {}) };
    if (!admin) Object.assign(input, cfg.members.createDefaults || {});
    const allowed = admin ? cfg.fields.map((f) => f.key) : [...schema.createFields, ...Object.keys(cfg.members.createDefaults || {})];
    const cl = await R.cleanData(q, c, input, allowed, true);
    if (cl.error) return res.status(400).json(cl);
    const data = cl.data;
    // module defaults (a new task starts "to do") apply whoever adds the record
    for (const [k, v] of Object.entries(cfg.defaults || {})) if (data[k] === undefined || data[k] === null) data[k] = v;
    // a member who adds a record owns it
    if (!admin && cfg.members.see === "own" && !R.isOwn(me, c, data)) {
      if (!me.memberId) return res.status(403).json({ error: "not_allowed" });
      const k = cfg.members.own[0];
      const f = R.fieldOf(c, k);
      data[k] = f.type === "members" ? [...(data[k] || []), me.memberId] : me.memberId;
    }
    for (const f of cfg.fields) if (f.today && !data[f.key]) data[f.key] = R.todaySG();
    let row;
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      try {
        [row] = await q(
          `insert into records (collection, seq, data, created_by, updated_by)
           values ($1, (select coalesce(max(seq), 0) + 1 from records where collection = $1), $2::jsonb, $3, $3) returning *`,
          [c, JSON.stringify(data), me.username]
        );
      } catch (e) {
        if (attempt === 2) throw e; // two people adding at the same moment: try the next number
      }
    }
    await log(q, me, "created", `record:${c}`, row.id, `${R.code(c, row.seq)} ${R.titleOf(c, data)}`);
    return res.status(201).json({ record: R.rowOut(c, row) });
  }

  if (req.method === "PATCH") {
    const id = R.idOf(b.id);
    const row = id ? await loadOne(id) : null;
    if (!row) return res.status(404).json({ error: "not_found" });
    const label = `${R.code(c, row.seq)} ${R.titleOf(c, row.data)}`;

    if (typeof b.archived === "boolean") {
      if (!admin) return res.status(403).json({ error: "not_allowed" });
      await q(`update records set archived = $2, updated_by = $3, updated_at = now() where id = $1`, [id, b.archived, me.username]);
      await log(q, me, b.archived ? "archived" : "restored", `record:${c}`, id, label);
      return res.status(200).json({ ok: true });
    }

    const allowed = row.archived ? [] : R.editableFields(me, c, row.data);
    const input = b.data && typeof b.data === "object" ? b.data : {};
    const tried = Object.keys(input).filter((k) => R.fieldOf(c, k));
    if (!tried.length) return res.status(400).json({ error: "nothing_to_change" });
    if (tried.some((k) => !allowed.includes(k))) return res.status(403).json({ error: "not_allowed" });
    const cl = await R.cleanData(q, c, input, allowed, false);
    if (cl.error) return res.status(400).json(cl);
    const next = { ...row.data, ...cl.data };
    // members can't hand away a record they own
    if (!admin && !R.isOwn(me, c, next)) return res.status(400).json({ error: "keep_yourself" });
    await q(`update records set data = $2::jsonb, updated_by = $3, updated_at = now() where id = $1`, [id, JSON.stringify(next), me.username]);
    const refs = await R.refsFor(q, c, [{ data: { ...row.data } }, { data: next }]);
    const changes = diff(row.data, cl.data, labels, (k, v) => R.display(c, k, v, refs));
    if (changes.length) await log(q, me, "updated", `record:${c}`, id, `${R.code(c, row.seq)} ${R.titleOf(c, next)}`, changes);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const id = R.idOf(b.id);
    const row = id ? await loadOne(id) : null;
    if (!row) return res.status(404).json({ error: "not_found" });
    await q(`delete from records where id = $1`, [id]);
    await log(q, me, "deleted", `record:${c}`, id, `${R.code(c, row.seq)} ${R.titleOf(c, row.data)}`);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

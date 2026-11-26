// Shared rules for the modules in lib/collections.js: who sees which records, checking what people
// type, and turning stored ids (people, units, linked records) into names.

const { COLLECTIONS } = require("./collections");

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const isAdmin = (u) => u && (u.role === "master" || u.role === "admin");
const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const todaySG = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const code = (c, seq) => `${COLLECTIONS[c].prefix}-${String(seq).padStart(4, "0")}`;
const fieldOf = (c, key) => COLLECTIONS[c].fields.find((f) => f.key === key);
const titleOf = (c, data) => String((data && data[COLLECTIONS[c].title]) || "").trim() || "(untitled)";

// the modules this person can open, and what they can do in each
function schemaFor(user) {
  const out = {};
  for (const [key, c] of Object.entries(COLLECTIONS)) {
    if (!isAdmin(user) && !c.members) continue;
    const m = c.members || {};
    out[key] = {
      key, label: c.label, noun: c.noun, prefix: c.prefix, group: c.group, icon: c.icon, title: c.title,
      sort: c.sort, due: c.due || null, overdue: c.overdue || null, done: c.done || null, totals: c.totals || null, chart: c.chart || null, pickerSub: c.pickerSub || null, formOrder: c.formOrder || null, newLabel: c.newLabel || null, autoTitle: c.autoTitle || null, steps: c.steps || null,
      fields: c.fields, ownTeam: (m.own || []).some((k) => (c.fields.find((f) => f.key === k) || {}).type === "unit"),
      defaults: isAdmin(user) ? c.defaults || {} : { ...(c.defaults || {}), ...(m.createDefaults || {}) },
      canCreate: isAdmin(user) || Array.isArray(m.create),
      createFields: isAdmin(user) ? c.fields.map((f) => f.key) : m.create || [],
      seeAll: isAdmin(user) || m.see === "all",
      admin: isAdmin(user),
    };
  }
  return out;
}

const canOpen = (user, c) => Boolean(COLLECTIONS[c]) && (isAdmin(user) || Boolean(COLLECTIONS[c].members));

// The teams an admin has marked on the org chart to manage modules (settings "managers:<setting>" = unit id),
// and the labels of those settings, for the unit page.
const MANAGER_GROUPS = [];
for (const c of Object.values(COLLECTIONS)) {
  const mg = c.members && c.members.managers;
  if (mg && mg.label && !MANAGER_GROUPS.some((g) => g.key === mg.setting)) MANAGER_GROUPS.push({ key: mg.setting, label: mg.label });
}
async function managerUnits(q) {
  const rows = await q(`select key, value from settings where key like 'managers:%'`);
  return Object.fromEntries(rows.map((r) => [r.key.slice(9), Number(r.value)]));
}
// members seated in a unit or anywhere under it
async function seatedUnder(q, unitId) {
  if (!unitId) return [];
  return (await q(
    `with recursive t(id) as (select $1::bigint union select o.id from org_units o join t on o.parent_id = t.id)
     select distinct s.member_id from seats s join members m on m.id = s.member_id where s.unit_id in (select id from t) and m.status <> 'alumni'`,
    [unitId]
  )).map((r) => Number(r.member_id));
}

// This person's part of the org chart (user.units): the units they sit in, everything under them, and the
// units above them. Their seats' units alone are user.seatUnits; the modules their team manages, user.manages.
// Call once per request, before the rules below.
async function withUnits(q, user) {
  if (!user || user.units) return user;
  user.units = [];
  user.seatUnits = [];
  user.manages = [];
  if (!user.memberId) return user;
  user.seatUnits = (await q(`select unit_id from seats where member_id = $1 and unit_id is not null order by sort, id`, [user.memberId])).map((r) => Number(r.unit_id));
  if (!user.seatUnits.length) return user;
  user.units = (await q(
    `with recursive down(id) as (select id from org_units where id = any($1::bigint[]) union select o.id from org_units o join down on o.parent_id = down.id),
          up(id, parent_id) as (select id, parent_id from org_units where id = any($1::bigint[]) union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
     select id from down union select id from up`,
    [user.seatUnits]
  )).map((r) => Number(r.id));
  const managers = await managerUnits(q);
  for (const [setting, unitId] of Object.entries(managers)) {
    if ((await seatedUnder(q, unitId)).includes(user.memberId)) user.manages.push(setting);
  }
  return user;
}

// does this person's team manage this module (all of it, or the records where `when` is filled in)?
function managing(user, c) {
  const mg = (COLLECTIONS[c].members || {}).managers;
  return mg && (user.manages || []).includes(mg.setting) ? mg : null;
}
function managesSql(user, c) {
  const mg = managing(user, c);
  if (!mg) return null;
  if (!mg.when || !KEY_RE.test(mg.when)) return "true";
  return `coalesce(data->'${mg.when}', 'null'::jsonb) not in ('null'::jsonb, '[]'::jsonb, '""'::jsonb)`;
}
function managesRec(user, c, data) {
  const mg = managing(user, c);
  if (!mg) return false;
  if (!mg.when) return true;
  const v = data[mg.when];
  return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
}

// SQL: the record is this person's (one of the module's `own` fields includes them or their part of the org chart,
// or their team manages the module; leave that out with { managers: false })
function ownSql(user, c, p, { managers = true } = {}) {
  const m = COLLECTIONS[c].members;
  if (!m || !user.memberId) return "false";
  const mg = managers ? managesSql(user, c) : null;
  if (mg === "true") return "true";
  if (!(m.own || []).length) return mg ? `(${mg})` : "false";
  const own = m.own.filter((k) => KEY_RE.test(k)).map((k) => {
    const f = fieldOf(c, k);
    if (f && f.type === "unit") return (user.units || []).length ? `(data->>'${k}')::bigint = any(${p(user.units)}::bigint[])` : "false";
    if (f && f.type === "members") return `coalesce(data->'${k}', '[]'::jsonb) @> jsonb_build_array(${p(user.memberId)}::bigint)`;
    return `data->>'${k}' = ${p(String(user.memberId))}`;
  });
  if (mg) own.push(mg);
  return own.length ? `(${own.join(" or ")})` : "false";
}

// SQL that limits a records query to what this person may see. p(value) adds a parameter and returns "$n".
function visibleSql(user, c, p) {
  if (isAdmin(user)) return "true";
  const m = COLLECTIONS[c].members;
  if (!m) return "false";
  const parts = [];
  if (m.where && KEY_RE.test(m.where.field)) parts.push(`coalesce(data->>'${m.where.field}', '') = any(${p(m.where.values)}::text[])`);
  if (m.see === "own") parts.push(ownSql(user, c, p));
  return parts.length ? parts.join(" and ") : "true";
}

// is this record theirs to change? (without `own` fields, every record they can see is)
function isOwn(user, c, data) {
  const m = COLLECTIONS[c].members;
  if (!m || !user.memberId) return false;
  if (!(m.own || []).length || managesRec(user, c, data)) return true;
  return m.own.some((k) => {
    const v = data[k];
    if (v === null || v === undefined) return false;
    if ((fieldOf(c, k) || {}).type === "unit") return (user.units || []).includes(Number(v));
    return Array.isArray(v) ? v.map(Number).includes(user.memberId) : Number(v) === user.memberId;
  });
}

// fields this person may change on this record
function editableFields(user, c, data) {
  const cfg = COLLECTIONS[c];
  if (isAdmin(user)) return cfg.fields.map((f) => f.key);
  const m = cfg.members;
  if (!m || !m.edit || !isOwn(user, c, data)) return [];
  if (m.lock && m.lock.values.includes(data[m.lock.field])) return [];
  return m.edit;
}

// → { data } or { error, field }. Only `allowed` keys are taken from input.
async function cleanData(q, c, input, allowed, creating) {
  const cfg = COLLECTIONS[c];
  const data = {};
  const people = new Set(), units = new Set(), links = {};
  for (const f of cfg.fields) {
    if (!allowed.includes(f.key) || !(f.key in input)) continue;
    let v = input[f.key];
    const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
    if (empty) { data[f.key] = f.type === "members" || f.type === "links" ? [] : f.type === "check" ? false : null; continue; }
    const bad = { error: "bad_field", field: f.label };
    switch (f.type) {
      case "text": case "phone": v = String(v).trim().slice(0, f.type === "phone" ? 40 : 300); break;
      case "long": v = String(v).trim().slice(0, 10000); break;
      case "date": v = String(v).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad; break;
      case "number": v = Number(v); if (!Number.isFinite(v) || Math.abs(v) > 1e9) return bad; break;
      case "money": v = Math.round(Number(String(v).replace(/[$,\s]/g, "")) * 100) / 100; if (!Number.isFinite(v) || Math.abs(v) > 1e9) return bad; break;
      case "select": v = String(v); if (!f.options.includes(v)) return bad; break;
      case "check": v = v === true || v === "true" || v === "on" || v === 1; break;
      case "url": v = String(v).trim().slice(0, 500); if (!/^https?:\/\/\S+$/.test(v)) return { error: "bad_url", field: f.label }; break;
      case "email": v = String(v).trim().slice(0, 160); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: "bad_email", field: f.label }; break;
      case "member": v = idOf(v); if (!v) return bad; people.add(v); break;
      case "members": {
        if (!Array.isArray(v)) v = [v];
        v = [...new Set(v.map(idOf))];
        if (v.some((x) => !x) || v.length > 100) return bad;
        v.forEach((x) => people.add(x));
        break;
      }
      case "unit": v = idOf(v); if (!v) return bad; units.add(v); break;
      case "link": v = idOf(v); if (!v) return bad; (links[f.to] = links[f.to] || new Set()).add(v); break;
      case "links": {
        if (!Array.isArray(v)) v = [v];
        v = [...new Set(v.map(idOf))];
        if (v.some((x) => !x) || v.length > 200) return bad;
        const set = (links[f.to] = links[f.to] || new Set());
        v.forEach((x) => set.add(x));
        break;
      }
      default: return bad;
    }
    data[f.key] = v;
  }
  if (people.size) {
    const found = await q(`select id from members where id = any($1::bigint[])`, [[...people]]);
    if (found.length !== people.size) return { error: "bad_person" };
  }
  if (units.size) {
    const found = await q(`select id from org_units where id = any($1::bigint[])`, [[...units]]);
    if (found.length !== units.size) return { error: "bad_unit" };
  }
  for (const [to, ids] of Object.entries(links)) {
    const found = await q(`select id from records where collection = $1 and id = any($2::bigint[])`, [to, [...ids]]);
    if (found.length !== ids.size) return { error: "bad_record_link" };
  }
  for (const f of cfg.fields) {
    if (!f.required) continue;
    const v = creating ? data[f.key] : f.key in data ? data[f.key] : undefined;
    if ((creating || f.key in data) && (v === null || v === undefined || v === "")) return { error: "required", field: f.label };
  }
  return { data };
}

// fields marked fromManagers take someone from the managing team; oneEach ones, someone on no other record
async function checkPeople(q, c, data, id) {
  const cfg = COLLECTIONS[c];
  const mg = (cfg.members || {}).managers;
  for (const f of cfg.fields) {
    const v = data[f.key];
    if (f.type !== "member" || v === null || v === undefined || !KEY_RE.test(f.key)) continue;
    if (f.fromManagers && mg) {
      const unitId = (await managerUnits(q))[mg.setting];
      if (unitId && !(await seatedUnder(q, unitId)).includes(Number(v))) return { error: "not_in_team", field: f.label };
    }
    if (f.oneEach) {
      const [other] = await q(`select data from records where collection = $1 and not archived and id <> $2 and data->>'${f.key}' = $3 limit 1`, [c, id || 0, String(v)]);
      if (other) return { error: "one_each", field: f.label, other: titleOf(c, other.data) };
    }
  }
  return null;
}

// who can be picked for a fromManagers field: the managing team (everyone, if no team is marked), and what each is on now
async function eligible(q, c, key) {
  const cfg = COLLECTIONS[c];
  const f = fieldOf(c, key);
  if (!f || f.type !== "member" || !f.fromManagers || !KEY_RE.test(key)) return null;
  const mg = (cfg.members || {}).managers;
  const unitId = mg ? (await managerUnits(q))[mg.setting] : null;
  const ids = unitId ? await seatedUnder(q, unitId) : null;
  const people = await q(`select id, name from members where status <> 'alumni' ${ids ? "and id = any($1::bigint[])" : ""} order by lower(name)`, ids ? [ids] : []);
  const on = await q(`select id, data from records where collection = $1 and not archived and coalesce(data->>'${key}', '') <> ''`, [c]);
  return { team: Boolean(unitId), people: people.map((x) => {
    const r = on.find((y) => String(y.data[key]) === String(x.id));
    return { id: Number(x.id), name: x.name, on: r ? { id: Number(r.id), title: titleOf(c, r.data) } : null };
  }) };
}

// fields that are needed once their date has come (requiredOnce): a meeting's notes once it's happened
function requiredNow(c, data) {
  for (const f of COLLECTIONS[c].fields) {
    if (!f.requiredOnce) continue;
    const when = data[f.requiredOnce];
    const v = data[f.key];
    if (when && String(when) <= todaySG() && (v === null || v === undefined || String(v).trim() === "")) return { error: "required", field: f.label };
  }
  return null;
}

// names for the ids in these records: { members: {id: name}, units: {id: label}, links: {module: {id: title}} }
async function refsFor(q, c, rows) {
  const cfg = COLLECTIONS[c];
  const people = new Set(), units = new Set(), links = {};
  for (const r of rows) {
    const d = r.data || {};
    for (const f of cfg.fields) {
      const v = d[f.key];
      if (v === null || v === undefined) continue;
      if (f.type === "member") people.add(Number(v));
      if (f.type === "members" && Array.isArray(v)) v.forEach((x) => people.add(Number(x)));
      if (f.type === "unit") units.add(Number(v));
      if (f.type === "link") (links[f.to] = links[f.to] || new Set()).add(Number(v));
      if (f.type === "links" && Array.isArray(v)) v.forEach((x) => (links[f.to] = links[f.to] || new Set()).add(Number(x)));
    }
  }
  const out = { members: {}, units: {}, links: {} };
  if (people.size) for (const m of await q(`select id, name from members where id = any($1::bigint[])`, [[...people]])) out.members[m.id] = m.name;
  if (units.size) for (const u of await q(`select id, code, name from org_units where id = any($1::bigint[])`, [[...units]])) out.units[u.id] = [u.code, u.name].filter(Boolean).join(" ");
  for (const [to, ids] of Object.entries(links)) {
    out.links[to] = {};
    for (const r of await q(`select id, data from records where collection = $1 and id = any($2::bigint[])`, [to, [...ids]])) out.links[to][r.id] = titleOf(to, r.data);
  }
  return out;
}

// a stored value as people read it (for the activity log)
function display(c, key, v, refs) {
  const f = fieldOf(c, key);
  if (!f || v === null || v === undefined || v === "") return v;
  if (f.type === "member") return refs.members[v] || `#${v}`;
  if (f.type === "members") return (v || []).map((x) => refs.members[x] || `#${x}`).join(", ");
  if (f.type === "unit") return refs.units[v] || `#${v}`;
  if (f.type === "link") return (refs.links[f.to] || {})[v] || `#${v}`;
  if (f.type === "links") return (v || []).map((x) => (refs.links[f.to] || {})[x] || `#${x}`).join(", ");
  if (f.type === "money") return `S$${Number(v).toFixed(2)}`;
  if (f.type === "check") return v ? "yes" : "no";
  if (f.type === "long") return String(v).length > 80 ? String(v).slice(0, 80) + "…" : v;
  return v;
}

const rowOut = (c, r) => ({
  id: Number(r.id), seq: r.seq, code: code(c, r.seq), data: r.data, archived: r.archived,
  created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at,
});

module.exports = {
  COLLECTIONS, KEY_RE, MANAGER_GROUPS, isAdmin, idOf, todaySG, code, fieldOf, titleOf, schemaFor, canOpen, withUnits, managerUnits, seatedUnder,
  ownSql, visibleSql, isOwn, editableFields, cleanData, checkPeople, eligible, requiredNow, refsFor, display, rowOut,
};

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
      sort: c.sort, due: c.due || null, done: c.done || null, totals: c.totals || null,
      fields: c.fields,
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

// SQL that limits a records query to what this person may see. p(value) adds a parameter and returns "$n".
function visibleSql(user, c, p) {
  if (isAdmin(user)) return "true";
  const m = COLLECTIONS[c].members;
  if (!m) return "false";
  const parts = [];
  if (m.where && KEY_RE.test(m.where.field)) parts.push(`coalesce(data->>'${m.where.field}', '') = any(${p(m.where.values)}::text[])`);
  if (m.see === "own") {
    if (!user.memberId) return "false";
    const me = p(user.memberId);
    const own = (m.own || []).filter((k) => KEY_RE.test(k)).map((k) => {
      const f = fieldOf(c, k);
      return f && f.type === "members"
        ? `coalesce(data->'${k}', '[]'::jsonb) @> jsonb_build_array(${me}::bigint)`
        : `data->>'${k}' = ${me}::text`;
    });
    parts.push(own.length ? `(${own.join(" or ")})` : "false");
  }
  return parts.length ? parts.join(" and ") : "true";
}

function isOwn(user, c, data) {
  const m = COLLECTIONS[c].members;
  if (!m || !user.memberId) return false;
  if (m.see !== "own") return true;
  return (m.own || []).some((k) => {
    const v = data[k];
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
    if (empty) { data[f.key] = f.type === "members" ? [] : f.type === "check" ? false : null; continue; }
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
  COLLECTIONS, KEY_RE, isAdmin, idOf, todaySG, code, fieldOf, titleOf, schemaFor, canOpen, visibleSql,
  isOwn, editableFields, cleanData, refsFor, display, rowOut,
};

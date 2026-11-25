// /api/admin/home — the things that span the whole portal.
//   GET    ?view=dashboard                       → what needs attention, for this person
//   GET    ?view=search&q=                        → matching people, applications, teams and records
//   GET    ?view=activity [&kind=&ref=]           → a record's timeline (history + notes), or the whole log (admins)
//   POST   { action: "note", kind, ref, text }    → leave a note on a record's timeline
//   DELETE ?note=                                 → remove a note (its author, or an admin)

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { log } = require("../../lib/activity");
const R = require("../../lib/records");
const { LEANING } = require("../../lib/org");
const F = require("../../lib/finance");

const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// where an activity line links to
function hrefOf(kind, ref) {
  if (!ref) return null;
  if (kind.startsWith("record:")) return `#/r/${kind.slice(7)}/${ref}`;
  return { member: `#/m/${ref}`, application: `#/a/${ref}`, account: `#/accounts/${ref}`, unit: `#/org/${ref}`, ip: `#/w/ip/${ref}`, event: `#/w/event/${ref}`,
    claim: `#/fin/c/${ref}`, budget: `#/fin/b/${ref}`, bank: "#/fin/bank" }[kind] || null;
}

// can this person see (and leave notes on) this timeline? → the record's label, or null
async function timelineAccess(q, me, kind, ref) {
  if (kind === "claim" || kind === "budget") {
    const fm = await F.whoIs(q, me);
    if (kind === "claim") {
      const [c] = await q(`select seq, description, claimant_id, division_id from fin_claims where id = $1`, [ref]);
      return c && (Number(c.claimant_id) === me.memberId || fm.inPurview(c.division_id)) ? `${F.claimCode(c.seq)} ${c.description}` : null;
    }
    const [b] = await q(`select name, division_id, is_reserve from fin_budgets where id = $1`, [ref]);
    return b && (b.is_reserve ? fm.finance : fm.inPurview(b.division_id)) ? b.name : null;
  }
  if (kind.startsWith("record:")) {
    const c = kind.slice(7);
    if (!R.canOpen(me, c)) return null;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const [row] = await q(`select seq, data from records where collection = ${p(c)} and id = ${p(ref)} and ${R.visibleSql(me, c, p)}`, params);
    return row ? `${R.code(c, row.seq)} ${R.titleOf(c, row.data)}` : null;
  }
  if (!R.isAdmin(me)) return null;
  const table = { member: "members", application: "applications", unit: "org_units" }[kind];
  if (kind === "account" && me.role !== "master") return null;
  if (kind === "account") { const [a] = await q(`select name from accounts where id = $1`, [ref]); return a ? a.name : null; }
  if (!table) return null;
  const [row] = await q(`select name from ${table} where id = $1`, [ref]);
  return row ? row.name : null;
}

async function listOf(q, me, c, extra, order, limit) {
  if (!R.canOpen(me, c)) return [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const rows = await q(
    `select * from records where collection = ${p(c)} and archived = false and ${R.visibleSql(me, c, p)} and ${extra(p)} order by ${order} limit ${limit}`,
    params
  );
  const refs = await R.refsFor(q, c, rows);
  return rows.map((r) => ({ ...R.rowOut(c, r), title: R.titleOf(c, r.data), refs: undefined, names: namesFor(c, r.data, refs) }));
}
// readable versions of a record's people/unit/link fields, for the dashboard
function namesFor(c, data, refs) {
  const out = {};
  for (const f of R.COLLECTIONS[c].fields) {
    if (["member", "members", "unit", "link"].includes(f.type) && data[f.key] !== undefined && data[f.key] !== null) out[f.key] = R.display(c, f.key, data[f.key], refs);
  }
  return out;
}

async function dashboard(q, me) {
  const today = R.todaySG();
  const admin = R.isAdmin(me);
  const has = (c) => Boolean(R.COLLECTIONS[c]);
  const mine = (c) => (p) => {
    const keys = R.COLLECTIONS[c].fields.filter((f) => f.type === "member" || f.type === "members");
    if (!me.memberId) return "false";
    return `(${keys.map((f) => (f.type === "members" ? `coalesce(data->'${f.key}', '[]'::jsonb) @> jsonb_build_array(${p(me.memberId)}::bigint)` : `data->>'${f.key}' = ${p(String(me.memberId))}`)).join(" or ")})`;
  };
  const and = (...fs) => (p) => fs.map((f) => f(p)).join(" and ");
  const from = (k) => (p) => `data->>'${k}' >= ${p(today)}`;
  const out = { today, role: me.role, modules: Object.keys(R.COLLECTIONS) };

  if (has("meetings")) out.myMeetings = await listOf(q, me, "meetings", and(from("date"), mine("meetings")), `data->>'date' asc`, 5);
  // their partners' next steps: overdue, or due in the next two weeks
  if (has("partners") && R.fieldOf("partners", "next_date")) {
    const soon = new Date(Date.now() + 8 * 3600e3 + 14 * 864e5).toISOString().slice(0, 10);
    out.followUps = await listOf(q, me, "partners",
      (p) => `coalesce(data->>'next_date', '') <> '' and data->>'next_date' <= ${p(soon)} and ${R.ownSql(me, "partners", p, { managers: false })}`, `data->>'next_date' asc`, 8);
  }
  // partnerships: each member of the team that looks after partners, and the partnership they lead
  const leadField = has("partners") && R.COLLECTIONS.partners.fields.find((f) => f.fromManagers && f.oneEach);
  const partnersTeam = leadField ? (await R.managerUnits(q)).partners : null;
  if (partnersTeam && (admin || (me.manages || []).includes("partners"))) {
    const ids = await R.seatedUnder(q, partnersTeam);
    const people = ids.length ? await q(`select id, name from members where id = any($1::bigint[]) order by lower(name)`, [ids]) : [];
    const led = await q(`select id, data from records where collection = 'partners' and not archived and coalesce(data->>'${leadField.key}', '') <> ''`);
    const [{ n: unled }] = await q(`select count(*)::int as n from records where collection = 'partners' and not archived and coalesce(data->>'parent', '') = ''
      and coalesce(data->>'status', '') <> 'past' and coalesce(data->>'${leadField.key}', '') = ''`);
    out.partnerships = {
      people: people.map((x) => {
        const r = led.find((y) => String(y.data[leadField.key]) === String(x.id));
        return { id: Number(x.id), name: x.name, partner: r ? { id: Number(r.id), title: R.titleOf("partners", r.data) } : null };
      }),
      unled,
    };
  }

  // finance: my claims; claims waiting for me; claims to disburse
  const fm = await F.whoIs(q, me);
  out.finance = { isLead: fm.isLead, finance: fm.finance };
  const claimRow = (c) => ({ id: Number(c.id), code: F.claimCode(c.seq), description: c.description, amount_cents: Number(c.amount_cents), status: c.status,
    status_label: F.statusLabel(c.status, c.kind), claimant_name: c.claimant_name, created_at: c.created_at });
  if (me.memberId) out.myClaims = (await q(`select * from fin_claims where claimant_id = $1 order by created_at desc limit 5`, [me.memberId])).map(claimRow);
  if (fm.finance || fm.isLead) {
    const rows = fm.finance
      ? await q(`select * from fin_claims where status = 'pending_finance' or (status = 'pending_review' and claimant_id <> $1) order by created_at limit 50`, [me.memberId || 0])
      : await q(`select * from fin_claims where status = 'pending_review' and claimant_id <> $1 and division_id = any($2::bigint[]) order by created_at limit 50`, [me.memberId || 0, [...fm.leads]]);
    out.toReview = rows.map(claimRow);
  }
  if (fm.finance) {
    const rows = await q(`select * from fin_claims where status = 'approved' order by updated_at limit 50`);
    out.toDisburse = rows.map(claimRow);
  }

  if (!admin) {
    if (me.memberId) {
      out.mySeats = await q(
        `select s.role, u.code, u.name from seats s left join org_units u on u.id = s.unit_id where s.member_id = $1 order by s.sort`,
        [me.memberId]
      );
    }
    return out;
  }

  const one = async (sql, params = []) => (await q(sql, params))[0];
  out.counts = {
    members: (await one(`select count(*)::int as n from members where status = 'active'`)).n,
    joining: (await one(`select count(*)::int as n from members where status = any($1::text[])`, [LEANING])).n,
    newApplications: (await one(`select count(*)::int as n from applications where status = 'new'`)).n,
  };
  if (has("partners")) out.counts.activePartners = (await one(`select count(*)::int as n from records where collection = 'partners' and not archived and data->>'status' = 'active'`)).n;
  if (me.role === "master") out.counts.pendingLinks = (await one(`select count(*)::int as n from accounts where password_hash is null and setup_expires > now() and not disabled`)).n;
  out.applications = (await q(`select id, name, created_at, life_stage from applications where status = 'new' order by created_at desc limit 5`)).map((a) => ({ ...a, id: Number(a.id) }));
  out.recent = (await q(`select * from activity where action <> 'signed in' order by at desc limit 12`)).map((a) => ({ ...a, id: Number(a.id), href: hrefOf(a.kind, a.ref_id) }));
  return out;
}

async function search(q, me, text) {
  const groups = [];
  if (text.length < 2) return groups;
  const t = like(text);
  const add = (key, label, items) => { if (items.length) groups.push({ key, label, items }); };
  add("members", "members", (await q(
    `select m.id, m.name, m.status, (select string_agg(s.role || coalesce(' · ' || u.name, ''), ', ' order by s.sort) from seats s left join org_units u on u.id = s.unit_id where s.member_id = m.id) as seats
       from members m where m.name ilike $1 or coalesce(m.telegram,'') ilike $1 or coalesce(m.title,'') ilike $1 order by lower(m.name) limit 8`, [t]
  )).map((m) => ({ href: `#/m/${m.id}`, title: m.name, sub: m.seats || "" })));
  add("units", "org chart", (await q(`select id, kind, code, name from org_units where name ilike $1 or coalesce(code,'') ilike $1 order by lower(name) limit 6`, [t]))
    .map((u) => ({ href: R.isAdmin(me) ? `#/org/${u.id}` : "#/members/chart", title: [u.code, u.name].filter(Boolean).join(" "), sub: u.kind })));
  if (R.isAdmin(me)) {
    add("applications", "applications", (await q(
      `select id, name, status, created_at from applications where name ilike $1 or coalesce(telegram,'') ilike $1 or coalesce(school,'') ilike $1 order by created_at desc limit 6`, [t]
    )).map((a) => ({ href: `#/a/${a.id}`, title: a.name, sub: a.status })));
  }
  for (const c of Object.keys(R.COLLECTIONS)) {
    if (!R.canOpen(me, c)) continue;
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const rows = await q(`select id, seq, data from records where collection = ${p(c)} and not archived and ${R.visibleSql(me, c, p)} and data::text ilike ${p(t)} order by seq desc limit 6`, params);
    add(c, R.COLLECTIONS[c].label, rows.map((r) => ({ href: `#/r/${c}/${r.id}`, title: R.titleOf(c, r.data), sub: R.code(c, r.seq) })));
  }
  {
    const fm = await F.whoIs(q, me);
    const rows = await q(
      `select id, seq, description, claimant_name, status, kind, claimant_id, division_id from fin_claims
        where (description ilike $1 or claimant_name ilike $1 or coalesce(vendor_name,'') ilike $1) order by created_at desc limit 40`, [t]);
    add("claims", "claims", rows.filter((c) => Number(c.claimant_id) === me.memberId || fm.inPurview(c.division_id)).slice(0, 6)
      .map((c) => ({ href: `#/fin/c/${c.id}`, title: c.description, sub: `${F.claimCode(c.seq)} · ${c.claimant_name} · ${F.statusLabel(c.status, c.kind)}` })));
  }
  if (me.role === "master") {
    add("accounts", "accounts", (await q(`select id, name, username, role from accounts where name ilike $1 or username ilike $1 order by lower(name) limit 5`, [t]))
      .map((a) => ({ href: `#/accounts/${a.id}`, title: a.name, sub: `@${a.username} · ${a.role}` })));
  }
  return groups;
}

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });
  const admin = R.isAdmin(me);
  await R.withUnits(q, me);

  if (req.method === "GET" && req.query.view === "dashboard") return res.status(200).json(await dashboard(q, me));
  if (req.method === "GET" && req.query.view === "search") return res.status(200).json({ groups: await search(q, me, String(req.query.q || "").trim().slice(0, 100)) });

  if (req.method === "GET" && req.query.view === "activity") {
    const kind = String(req.query.kind || "");
    const ref = R.idOf(req.query.ref);
    if (kind) {
      if (!ref || !(await timelineAccess(q, me, kind, ref))) return res.status(404).json({ error: "not_found" });
      const rows = await q(`select * from activity where kind = $1 and ref_id = $2 order by at desc, id desc limit 200`, [kind, ref]);
      return res.status(200).json({ entries: rows.map((a) => ({ ...a, id: Number(a.id), mine: a.actor === me.username })) });
    }
    if (!admin) return res.status(403).json({ error: "not_allowed" });
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const where = ["true"];
    if (req.query.area) where.push(`(kind = ${p(String(req.query.area))} or kind like ${p(String(req.query.area) + ":%")})`);
    if (req.query.who) where.push(`(actor ilike ${p(like(String(req.query.who)))} or actor_name ilike ${p(like(String(req.query.who)))})`);
    if (me.role !== "master") where.push(`kind not in ('account', 'session')`);
    const before = R.idOf(req.query.before);
    if (before) where.push(`id < ${p(before)}`);
    const rows = await q(`select * from activity where ${where.join(" and ")} order by id desc limit 100`, params);
    return res.status(200).json({ entries: rows.map((a) => ({ ...a, id: Number(a.id), href: hrefOf(a.kind, a.ref_id) })) });
  }

  const b = req.method === "DELETE" ? req.query : auth.body(req);

  if (req.method === "POST" && b.action === "note") {
    const kind = String(b.kind || "");
    const ref = R.idOf(b.ref);
    const text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "empty_note" });
    const label = ref ? await timelineAccess(q, me, kind, ref) : null;
    if (!label) return res.status(404).json({ error: "not_found" });
    await log(q, me, "note", kind, ref, label, null, text);
    return res.status(201).json({ ok: true });
  }

  if (req.method === "DELETE" && b.note !== undefined) {
    const id = R.idOf(b.note);
    const [n] = id ? await q(`select * from activity where id = $1 and action = 'note'`, [id]) : [];
    if (!n || (n.actor !== me.username && !admin)) return res.status(404).json({ error: "not_found" });
    await q(`delete from activity where id = $1`, [id]);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

// Copies the finance app's data (the-newnormal/finance, on Supabase) into the portal's finance tables.
// A Master Admin runs it from finance setup, in three steps:
//   check     read the app; suggest who's who (its people → members, its divisions → org-chart divisions)
//   import    copy everything but the receipt files, with the people and divisions as chosen
//   receipts  copy the receipt files, a batch per call (each call stays inside a function's time limit)
// Every copied row remembers where it came from (legacy_id), so running it again adds only what's new.
//
// Needs, in Vercel: FINANCE_SUPABASE_URL (the app's NEXT_PUBLIC_SUPABASE_URL) and FINANCE_SUPABASE_KEY (its
// SUPABASE_SERVICE_ROLE_KEY); and FINANCE_PAYOUT_KEY (the app's PAYOUT_ENCRYPTION_KEY) unless the portal's
// PAYOUT_ENCRYPTION_KEY is that same key. Payout details are decrypted with the app's key and its owner
// (the app's member id), and encrypted again with the portal's key and owner (the portal's member id).

const crypto = require("crypto");
const F = require("./finance");

function config() {
  const url = String(process.env.FINANCE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.FINANCE_SUPABASE_KEY || "").trim();
  if (!/^https?:\/\/[^\s/]+/.test(url) || !key) return null;
  const old = Buffer.from(String(process.env.FINANCE_PAYOUT_KEY || process.env.PAYOUT_ENCRYPTION_KEY || ""), "base64");
  return { url, key, oldKey: old.length === 32 ? old : null };
}

const fault = (code, message) => Object.assign(new Error(message || code), { code });
// a legacy service-role key is a JWT and also goes in Authorization; newer secret keys go in apikey only
const headers = (cfg) => ({ apikey: cfg.key, ...(/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(cfg.key) ? { Authorization: `Bearer ${cfg.key}` } : {}) });

// the app's tables, and the column to page through each in order; the first five must be there
const TABLES = {
  members: "id", divisions: "id", categories: "id", budgets: "id", claims: "created_at",
  division_leads: "member_id", member_payouts: "member_id", budget_categories: "budget_id", budget_guidelines: "budget_id",
  budget_commitments: "budget_id", budget_funds: "id", reserve_additions: "id", claim_events: "id",
  bank_accounts: "id", bank_entries: "id", claim_rules: "id", bank_entry_edits: "id",
};
const CORE = ["members", "divisions", "categories", "budgets", "claims"];

async function table(cfg, name, select = "*") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    let r;
    try {
      r = await fetch(`${cfg.url}/rest/v1/${name}?select=${select}&order=${TABLES[name]}.asc&limit=1000&offset=${offset}`, { headers: headers(cfg) });
    } catch {
      throw fault("import_unreachable");
    }
    if (r.status === 401 || r.status === 403) throw fault("import_denied");
    if (r.status === 404 && !CORE.includes(name)) return out; // a table an older version of the app didn't have
    if (!r.ok) throw fault("import_unreachable", `${name}: ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function readAll(cfg) {
  return Object.fromEntries(await Promise.all(Object.keys(TABLES).map(async (t) => [t, await table(cfg, t)])));
}

// the app's payout format is the portal's: "v1.<iv>.<tag>.<data>", AES-256-GCM, the owner's id as AAD
function openOld(cfg, token, owner) {
  const [version, iv, tag, data, ...rest] = String(token).split(".");
  if (version !== "v1" || !iv || !tag || !data || rest.length) throw fault("import_key");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", cfg.oldKey, Buffer.from(iv, "base64"), { authTagLength: 16 });
    d.setAAD(Buffer.from(String(owner), "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8"));
  } catch {
    throw fault("import_key");
  }
}
// can the app's payout details be read? null: there are none to read
function keyWorks(cfg, d) {
  const sample = d.claims.find((c) => c.payout_enc) || null;
  const saved = d.member_payouts[0] || null;
  if (!sample && !saved) return null;
  if (!cfg.oldKey) return false;
  try {
    if (sample) openOld(cfg, sample.payout_enc, sample.claimant_id);
    else openOld(cfg, saved.payout_enc, saved.member_id);
    return true;
  } catch {
    return false;
  }
}

const sgDay = (ts) => new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const lower = (s) => String(s || "").trim().toLowerCase();

async function previous(q) {
  const [row] = await q(`select value from settings where key = 'finance_import'`);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
async function remember(q, value) {
  await q(`insert into settings (key, value) values ('finance_import', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(value)]);
}

// who in the app has anything to copy (their claims or saved payout details)
function needed(d) {
  const people = new Set([...d.claims.map((c) => c.claimant_id), ...d.member_payouts.map((p) => p.member_id)]);
  const divisions = new Set([...d.budgets.filter((b) => !b.is_reserve).map((b) => b.division_id), ...d.claims.map((c) => c.division_id)].filter(Boolean));
  return { people, divisions };
}

// suggestions: what was chosen last time, then the same email, the same name, or a unique first-name match
function suggest(d, members, units, prev) {
  const ids = new Set(members.map((m) => m.id));
  const unitIds = new Set(units.map((u) => u.id));
  const people = {};
  for (const p of d.members) {
    const before = prev && prev.people && prev.people[p.id];
    if (before && ids.has(before)) { people[p.id] = { id: before, why: "chosen last time" }; continue; }
    const byEmail = p.email && members.find((m) => lower(m.email) === lower(p.email));
    if (byEmail) { people[p.id] = { id: byEmail.id, why: "same email" }; continue; }
    const byName = members.filter((m) => lower(m.name) === lower(p.name));
    if (byName.length === 1) { people[p.id] = { id: byName[0].id, why: "same name" }; continue; }
    const first = lower(p.name).split(/\s+/)[0];
    const byFirst = members.filter((m) => lower(m.name) === first || lower(p.name).startsWith(lower(m.name) + " "));
    if (byFirst.length === 1) { people[p.id] = { id: byFirst[0].id, why: "first name" }; continue; }
    people[p.id] = null;
  }
  const divisions = {};
  for (const x of d.divisions) {
    const before = prev && prev.divisions && prev.divisions[x.id];
    if (before && unitIds.has(before)) { divisions[x.id] = { id: before, why: "chosen last time" }; continue; }
    const same = units.find((u) => lower(u.name) === lower(x.name));
    divisions[x.id] = same ? { id: same.id, why: "same name" } : null;
  }
  return { people, divisions };
}

async function portalPeople(q) {
  const members = (await q(`select id, name, email from members order by lower(name)`)).map((m) => ({ id: Number(m.id), name: m.name, email: m.email }));
  const units = (await q(`select id, name from org_units where kind = 'division' order by sort, lower(name)`)).map((u) => ({ id: Number(u.id), name: u.name }));
  return { members, units };
}

// reversed reserve additions cancel out: both are left out
function reserveKept(d) {
  const reversed = new Set(d.reserve_additions.filter((r) => r.reverses_id).map((r) => String(r.reverses_id)));
  return d.reserve_additions.filter((r) => !r.reverses_id && !reversed.has(String(r.id)));
}

/* ── check ── */
async function check(q, cfg) {
  const d = await readAll(cfg);
  const prev = await previous(q);
  const { members, units } = await portalPeople(q);
  const sug = suggest(d, members, units, prev);
  const need = needed(d);
  const claimsOf = (id) => d.claims.filter((c) => c.claimant_id === id).length;
  const seats = await q(`select member_id, unit_id, role from seats`);
  const leadsInChart = (memberId, unitId) => seats.some((s) => Number(s.member_id) === memberId && Number(s.unit_id) === unitId && F.LEAD_ROLES.includes(s.role));
  const [{ n: already }] = await q(`select count(*)::int as n from fin_claims where legacy_id is not null`);
  const name = (list, id) => (list.find((x) => x.id === id) || {}).name || "";
  return {
    keyOk: keyWorks(cfg, d),
    portalKey: F.keyReady(),
    already,
    last: prev ? { at: prev.at, by: prev.by } : null,
    counts: {
      claims: d.claims.length,
      receipts: d.claims.reduce((n, c) => n + (c.attachment_paths || []).length, 0),
      budgets: d.budgets.filter((b) => !b.is_reserve).length,
      bankAccounts: d.bank_accounts.length,
      bankEntries: d.bank_entries.length,
      funds: d.budget_funds.length,
      reserveAdditions: reserveKept(d).length,
      rules: d.claim_rules.length,
      savedPayouts: d.member_payouts.length,
      history: d.claim_events.length,
    },
    leftOut: { bankEdits: d.bank_entry_edits.length, reversedReserve: d.reserve_additions.length - reserveKept(d).length },
    people: d.members.map((p) => ({
      id: p.id, name: p.name, email: p.email, role: p.role, active: p.active, claims: claimsOf(p.id), needed: need.people.has(p.id),
      suggest: sug.people[p.id] ? sug.people[p.id].id : null, why: sug.people[p.id] ? sug.people[p.id].why : null,
    })).sort((a, b) => b.claims - a.claims || a.name.localeCompare(b.name)),
    divisions: d.divisions.map((x) => ({
      id: x.id, name: x.name, budgets: d.budgets.filter((b) => b.division_id === x.id).length, needed: need.divisions.has(x.id),
      suggest: sug.divisions[x.id] ? sug.divisions[x.id].id : null, why: sug.divisions[x.id] ? sug.divisions[x.id].why : null,
    })),
    leads: d.division_leads.map((l) => {
      const p = d.members.find((m) => m.id === l.member_id) || {};
      const x = d.divisions.find((v) => v.id === l.division_id) || {};
      const pm = sug.people[l.member_id], du = sug.divisions[l.division_id];
      return { person: p.name || "", division: x.name || "", inChart: Boolean(pm && du && leadsInChart(pm.id, du.id)) };
    }),
    financeTeam: d.members.filter((m) => m.role === "finance").map((m) => ({ name: m.name, member: sug.people[m.id] ? name(members, sug.people[m.id].id) : null })),
    members, units,
  };
}

// insert rows as one statement: jsonb_to_recordset turns the JSON into a table
async function bulk(q, sql, cols, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    out.push(...await q(sql.replace("$ROWS", `jsonb_to_recordset($1::jsonb) as x(${cols})`), [JSON.stringify(part)]));
  }
  return out;
}

/* ── import (everything but the files) ── */
async function run(q, cfg, user, choice = {}) {
  if (!F.keyReady()) throw fault("payout_key");
  const d = await readAll(cfg);
  if (keyWorks(cfg, d) === false) throw fault("import_key");
  const prev = (await previous(q)) || {};
  const { members, units } = await portalPeople(q);
  const sug = suggest(d, members, units, prev);
  const need = needed(d);
  const memberIds = new Set(members.map((m) => m.id));
  const unitIds = new Set(units.map((u) => u.id));
  const created = { people: [], divisions: [] };

  // people: as chosen (a member, "new" or "skip"), else the suggestion; anyone with claims is never left out
  const people = {};
  for (const p of d.members) {
    const want = choice.people && choice.people[p.id] !== undefined ? String(choice.people[p.id]) : sug.people[p.id] ? String(sug.people[p.id].id) : "new";
    let id = Number(want);
    if (!memberIds.has(id)) id = null;
    if (!id && want === "skip" && !need.people.has(p.id)) continue;
    if (!id && prev.people && memberIds.has(prev.people[p.id]) && want !== "new") id = prev.people[p.id];
    if (!id && !need.people.has(p.id)) continue; // nothing of theirs to copy: don't add them
    if (!id) {
      const [m] = await q(`insert into members (name, email, status, notes) values ($1, $2, $3, $4) returning id`,
        [p.name, p.email || null, p.active === false ? "alumni" : "active", "Added by the import from the finance app."]);
      id = Number(m.id);
      memberIds.add(id);
      created.people.push(p.name);
    }
    people[p.id] = id;
  }
  // divisions: as chosen (a division or "new"), else the suggestion
  const divisions = {};
  for (const x of d.divisions) {
    const want = choice.divisions && choice.divisions[x.id] !== undefined ? String(choice.divisions[x.id]) : sug.divisions[x.id] ? String(sug.divisions[x.id].id) : "new";
    let id = Number(want);
    if (!unitIds.has(id)) id = null;
    if (!id && !need.divisions.has(x.id)) continue;
    if (!id) {
      const [u] = await q(`insert into org_units (kind, name, sort) values ('division', $1, (select coalesce(max(sort), 0) + 1 from org_units where kind = 'division')) returning id`, [x.name]);
      id = Number(u.id);
      unitIds.add(id);
      created.divisions.push(x.name);
    }
    divisions[x.id] = id;
  }
  // remembered at once, so a second run never adds the same people or divisions again
  await remember(q, { ...prev, people: { ...(prev.people || {}), ...people }, divisions: { ...(prev.divisions || {}), ...divisions } });

  // categories: the same name, else added
  const cats = {};
  const byName = new Map((await q(`select id, name from fin_categories`)).map((k) => [lower(k.name), Number(k.id)]));
  for (const k of d.categories) {
    let id = byName.get(lower(k.name));
    if (!id) {
      const grp = F.GROUPS[k.category_group] ? k.category_group : "operations";
      [{ id }] = await q(`insert into fin_categories (name, grp, active, sort) values ($1, $2, $3, (select coalesce(max(sort), 0) + 1 from fin_categories)) returning id`, [k.name, grp, k.active !== false]);
      id = Number(id);
      byName.set(lower(k.name), id);
    }
    cats[k.id] = id;
  }

  // budgets (the app's reserve is the portal's), their categories and guideline amounts
  const [reserve] = await q(`select id from fin_budgets where is_reserve`);
  const committed = Object.fromEntries(d.budget_commitments.map((c) => [c.budget_id, c.committed_cents]));
  await bulk(q, `insert into fin_budgets (legacy_id, name, kind, division_id, active, grant_committed_cents, created_at)
      select legacy_id, name, kind, division_id, active, committed, created_at from $ROWS on conflict (legacy_id) do nothing returning id`,
  "legacy_id text, name text, kind text, division_id bigint, active boolean, committed bigint, created_at timestamptz",
  d.budgets.filter((b) => !b.is_reserve).map((b) => ({ legacy_id: b.id, name: b.name, kind: b.kind === "general" ? "general" : "event",
    division_id: divisions[b.division_id] || null, active: b.active !== false, committed: Number(committed[b.id] || 0), created_at: b.created_at })));
  const budgets = Object.fromEntries((await q(`select id, legacy_id from fin_budgets where legacy_id is not null`)).map((r) => [r.legacy_id, Number(r.id)]));
  for (const b of d.budgets.filter((x) => x.is_reserve)) budgets[b.id] = Number(reserve.id);
  const guideline = new Map(d.budget_guidelines.map((g) => [`${g.budget_id}/${g.category_id}`, Number(g.guideline_cents)]));
  await bulk(q, `insert into fin_guidelines (budget_id, category_id, guideline_cents) select budget_id, category_id, cents from $ROWS on conflict do nothing returning budget_id`,
    "budget_id bigint, category_id bigint, cents bigint",
    d.budget_categories.filter((bc) => !(d.budgets.find((b) => b.id === bc.budget_id) || {}).is_reserve && budgets[bc.budget_id] && cats[bc.category_id])
      .map((bc) => ({ budget_id: budgets[bc.budget_id], category_id: cats[bc.category_id], cents: guideline.get(`${bc.budget_id}/${bc.category_id}`) || 0 })));

  // bank accounts (a name the portal already uses gets "(finance app)")
  const taken = new Set((await q(`select lower(name) as n from fin_bank_accounts where legacy_id is null`)).map((r) => r.n));
  await bulk(q, `insert into fin_bank_accounts (legacy_id, name, bank, last4, active, created_at) select legacy_id, name, bank, last4, active, created_at from $ROWS on conflict do nothing returning id`,
    "legacy_id text, name text, bank text, last4 text, active boolean, created_at timestamptz",
    d.bank_accounts.map((a) => ({ legacy_id: a.id, name: taken.has(lower(a.name)) ? `${a.name} (finance app)` : a.name, bank: a.bank || "DBS", last4: a.last4, active: a.active !== false, created_at: a.created_at })));
  const accounts = Object.fromEntries((await q(`select id, legacy_id from fin_bank_accounts where legacy_id is not null`)).map((r) => [r.legacy_id, Number(r.id)]));

  // claims, oldest first, numbered after the portal's own; payout details re-encrypted for their new owner
  const have = new Set((await q(`select legacy_id from fin_claims where legacy_id is not null`)).map((r) => r.legacy_id));
  let [{ seq }] = await q(`select coalesce(max(seq), 0)::int as seq from fin_claims`);
  const payoutDay = Object.fromEntries(d.bank_entries.filter((e) => e.kind === "payout" && e.claim_id).map((e) => [e.claim_id, e.entry_date]));
  const paidAt = Object.fromEntries(d.claim_events.filter((e) => e.action === "paid").map((e) => [e.claim_id, e.at]));
  const fresh = d.claims.filter((c) => !have.has(c.id)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const claimRows = fresh.map((c) => {
    const owner = people[c.claimant_id];
    let enc = null;
    if (c.payout_enc) enc = F.encryptPayout(openOld(cfg, c.payout_enc, c.claimant_id), owner);
    const items = Array.isArray(c.items) && c.items.length
      ? c.items.map((i) => ({ description: String(i.description || ""), amount_cents: Number.isFinite(Number(i.amount_cents)) && i.amount_cents !== null ? Number(i.amount_cents) : null, category_id: i.category_id ? cats[i.category_id] || null : null }))
      : null;
    seq += 1;
    return {
      legacy_id: c.id, seq, kind: c.kind === "invoice" ? "invoice" : "reimbursement", status: c.status, claimant_id: owner,
      claimant_name: c.claimant_name || (d.members.find((m) => m.id === c.claimant_id) || {}).name || "", division_id: c.division_id ? divisions[c.division_id] || null : null,
      budget_id: budgets[c.budget_id], category_id: cats[c.category_id], description: c.description, amount_cents: Number(c.amount_cents),
      expense_date: c.expense_date || null, vendor_name: c.vendor_name || null, due_date: c.due_date || null,
      payout_type: enc ? c.payout_type : null, payout_masked: enc ? c.payout_masked : null, payout_enc: enc,
      rejection_reason: c.rejection_reason || null, payment_reference: c.payment_reference || null,
      paid_on: c.status === "paid" ? payoutDay[c.id] || (paidAt[c.id] ? sgDay(paidAt[c.id]) : sgDay(c.updated_at)) : null,
      submission_id: c.submission_id || c.id, created_at: c.created_at, updated_at: c.updated_at, items,
    };
  });
  const inserted = await bulk(q, `insert into fin_claims (legacy_id, seq, kind, status, claimant_id, claimant_name, division_id, budget_id, category_id, description, amount_cents,
        expense_date, vendor_name, due_date, payout_type, payout_masked, payout_enc, rejection_reason, payment_reference, paid_on, submission_id, created_at, updated_at, items)
      select legacy_id, seq, kind, status, claimant_id, claimant_name, division_id, budget_id, category_id, description, amount_cents,
        expense_date, vendor_name, due_date, payout_type, payout_masked, payout_enc, rejection_reason, payment_reference, paid_on, submission_id, created_at, updated_at, items
      from $ROWS on conflict (legacy_id) do nothing returning id, legacy_id, seq, description`,
  `legacy_id text, seq int, kind text, status text, claimant_id bigint, claimant_name text, division_id bigint, budget_id bigint, category_id bigint, description text, amount_cents bigint,
    expense_date date, vendor_name text, due_date date, payout_type text, payout_masked text, payout_enc text, rejection_reason text, payment_reference text, paid_on date,
    submission_id text, created_at timestamptz, updated_at timestamptz, items jsonb`, claimRows);
  const claims = Object.fromEntries((await q(`select id, legacy_id from fin_claims where legacy_id is not null`)).map((r) => [r.legacy_id, Number(r.id)]));

  // each new claim's history, on its timeline
  const ACTIONS = { submitted: "submitted", reviewed: "reviewed", approved: "approved", rejected: "rejected", paid: "disbursed" };
  const newClaims = new Map(inserted.map((r) => [r.legacy_id, r]));
  await bulk(q, `insert into activity (at, actor, actor_name, action, kind, ref_id, label, note) select at, null, actor_name, action, 'claim', ref_id, label, note from $ROWS returning id`,
    "at timestamptz, actor_name text, action text, ref_id bigint, label text, note text",
    d.claim_events.filter((e) => newClaims.has(e.claim_id) && ACTIONS[e.action]).map((e) => {
      const c = newClaims.get(e.claim_id);
      return { at: e.at, actor_name: e.actor_name, action: ACTIONS[e.action], ref_id: Number(c.id), label: `${F.claimCode(c.seq)} ${c.description}`, note: e.note || null };
    }));

  // the bank ledger, in its order (current amounts: the app's edit history stays there)
  await bulk(q, `insert into fin_bank_entries (legacy_id, account_id, kind, amount_cents, entry_date, note, claim_id, transfer_id, actor, created_at)
      select legacy_id, account_id, kind, amount_cents, entry_date, note, claim_id, transfer_id, actor, created_at from $ROWS on conflict (legacy_id) do nothing returning id`,
  "legacy_id text, account_id bigint, kind text, amount_cents bigint, entry_date date, note text, claim_id bigint, transfer_id text, actor text, created_at timestamptz",
  [...d.bank_entries].sort((a, b) => Number(a.id) - Number(b.id)).filter((e) => accounts[e.account_id]).map((e) => ({
    legacy_id: String(e.id), account_id: accounts[e.account_id], kind: e.kind, amount_cents: Number(e.amount_cents), entry_date: e.entry_date, note: e.note || null,
    claim_id: e.claim_id ? claims[e.claim_id] || null : null, transfer_id: e.transfer_id || null, actor: e.actor_name || null, created_at: e.created_at })));
  const entries = Object.fromEntries((await q(`select id, legacy_id from fin_bank_entries where legacy_id is not null`)).map((r) => [r.legacy_id, Number(r.id)]));

  // budgets' grants, loans and repayments; the reserve's additions; the claim form's notices
  await bulk(q, `insert into fin_funds (legacy_id, budget_id, kind, amount_cents, entry_date, note, bank_entry_id, actor, created_at)
      select legacy_id, budget_id, kind, amount_cents, entry_date, note, bank_entry_id, actor, created_at from $ROWS on conflict (legacy_id) do nothing returning id`,
  "legacy_id text, budget_id bigint, kind text, amount_cents bigint, entry_date date, note text, bank_entry_id bigint, actor text, created_at timestamptz",
  d.budget_funds.filter((f) => budgets[f.budget_id]).map((f) => ({ legacy_id: String(f.id), budget_id: budgets[f.budget_id], kind: f.kind, amount_cents: Number(f.amount_cents),
    entry_date: f.entry_date, note: f.note || null, bank_entry_id: f.bank_entry_id ? entries[String(f.bank_entry_id)] || null : null, actor: f.actor_name || null, created_at: f.created_at })));
  await bulk(q, `insert into fin_reserve_additions (legacy_id, amount_cents, added_on, note, actor, created_at) select legacy_id, amount_cents, added_on, note, actor, created_at from $ROWS on conflict (legacy_id) do nothing returning id`,
    "legacy_id text, amount_cents bigint, added_on date, note text, actor text, created_at timestamptz",
    reserveKept(d).map((r) => ({ legacy_id: String(r.id), amount_cents: Number(r.amount_cents), added_on: r.added_on, note: r.note, actor: r.actor_name || null, created_at: r.created_at })));
  await bulk(q, `insert into fin_rules (legacy_id, title, body, applies_to, link_label, link_url, sort, active) select legacy_id, title, body, applies_to, link_label, link_url, sort, active from $ROWS on conflict (legacy_id) do nothing returning id`,
    "legacy_id text, title text, body text, applies_to text, link_label text, link_url text, sort int, active boolean",
    d.claim_rules.map((r) => ({ legacy_id: r.id, title: r.title, body: r.body, applies_to: ["all", "reimbursement", "invoice"].includes(r.applies_to) ? r.applies_to : "all",
      link_label: r.link_label || null, link_url: r.link_url || null, sort: Number(r.sort_order) || 0, active: r.active !== false })));

  // saved payout details (a member's own newer ones in the portal win)
  await bulk(q, `insert into fin_saved_payouts (member_id, payout_type, payout_masked, payout_enc, updated_at) select member_id, payout_type, payout_masked, payout_enc, updated_at from $ROWS on conflict (member_id) do nothing returning member_id`,
    "member_id bigint, payout_type text, payout_masked text, payout_enc text, updated_at timestamptz",
    d.member_payouts.filter((p) => people[p.member_id]).map((p) => ({ member_id: people[p.member_id], payout_type: p.payout_type, payout_masked: p.payout_masked,
      payout_enc: F.encryptPayout(openOld(cfg, p.payout_enc, p.member_id), people[p.member_id]), updated_at: p.updated_at })));

  // the app's Finance team: their logins go on the portal's
  const financeMembers = d.members.filter((m) => m.role === "finance" && people[m.id]).map((m) => people[m.id]);
  const financeTeam = financeMembers.length
    ? (await q(`update accounts set finance = true where member_id = any($1::bigint[]) and not finance and role <> 'master' returning name`, [financeMembers])).map((a) => a.name)
    : [];

  const counts = { claims: inserted.length, receiptsToCopy: fresh.reduce((n, c) => n + (c.attachment_paths || []).length, 0) };
  await remember(q, { ...(await previous(q)), at: new Date().toISOString(), by: user.username });
  return { counts, created, financeTeam };
}

/* ── receipts, a batch at a time ── */
const EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" };
async function receipts(q, cfg, skip = [], budgetMs = 7000) {
  const start = Date.now();
  const old = await table(cfg, "claims", "id,claimant_id,attachment_paths");
  const claims = new Map((await q(`select id, legacy_id, claimant_id from fin_claims where legacy_id is not null`)).map((r) => [r.legacy_id, r]));
  const done = new Set((await q(`select legacy_path from fin_files where legacy_path is not null`)).map((r) => r.legacy_path));
  const skipped = new Set(skip.map(String));
  const todo = [];
  for (const c of old) for (const path of c.attachment_paths || []) if (claims.has(c.id) && !done.has(path) && !skipped.has(path)) todo.push({ path, claim: claims.get(c.id) });
  let copied = 0;
  const failed = [];
  for (const t of todo) {
    if (Date.now() - start > budgetMs) break;
    try {
      const r = await fetch(`${cfg.url}/storage/v1/object/receipts/${t.path.split("/").map(encodeURIComponent).join("/")}`, { headers: headers(cfg) });
      if (!r.ok) throw new Error(String(r.status));
      const data = Buffer.from(await r.arrayBuffer());
      const name = t.path.split("/").pop().slice(0, 120) || "receipt";
      const type = (r.headers.get("content-type") || "").split(";")[0].trim() || EXT_TYPES[name.split(".").pop().toLowerCase()] || "application/octet-stream";
      await q(`insert into fin_files (owner_id, claim_id, name, type, size, data, legacy_path) values ($1, $2, $3, $4, $5, $6, $7) on conflict (legacy_path) do nothing`,
        [t.claim.claimant_id, t.claim.id, name, type, data.length, data, t.path]);
      copied += 1;
    } catch {
      failed.push(t.path);
    }
  }
  return { copied, failed, remaining: todo.length - copied - failed.length };
}

module.exports = { config, check, run, receipts };

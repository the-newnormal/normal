// /api/admin/finance — claims, budgets, disbursements and the bank (rules: lib/finance.js).
//
// GET  ?view=me                       what this person can do, the claim form's notices, their saved payout
// GET  ?view=claims&scope=mine|review|all|disburse|budget [&budget=] [&status=] [&q=]
// GET  ?view=claim&id=                one claim, its files, and what this person can do with it
// GET  ?view=file&id=                 a receipt or invoice (the file itself)
// GET  ?view=payout&id=               the payout details and PayNow QR of a claim to disburse   (Finance)
// GET  ?view=budgets                  budgets to claim against; figures for those in purview
// GET  ?view=budget&id=               one budget: guidelines and spending, funding, claims      (leads, Finance)
// GET  ?view=setup                    categories, claim-form notices, divisions                 (Finance)
// GET  ?view=bank [&account=]         accounts, balances and the ledger                         (Finance)
// GET  ?view=export                   every claim as a spreadsheet                              (Finance)
// POST { action: "upload", name, type, data }    a receipt (base64), before the claim is sent
// POST { action: "submit", ... }                 send a claim
// POST { action: "decide", id, approve, reason } review / final approval / reject
// POST { action: "pay", id, accountId, reference, date }   record the disbursement      (Finance)
// POST { action: "budget" | "category" | "rule" | "rule-delete" | "account" | "account-close" | "entry"
//        | "transfer" | "grant" | "loan" | "repay" | "reserve-add", ... }               (Finance)
// POST { action: "import-check" | "import-run" | "import-receipts", ... }   copy the finance app's data in (Master Admins; lib/finance-import.js)

const QRCode = require("qrcode");
const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { log } = require("../../lib/activity");
const F = require("../../lib/finance");
const FI = require("../../lib/finance-import");

const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const like = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const MAX_FILE = 3.5 * 1024 * 1024; // Vercel takes request bodies up to 4.5 MB, and base64 adds a third

const claimOut = (c) => ({
  id: Number(c.id), seq: c.seq, code: F.claimCode(c.seq), kind: c.kind, status: c.status, status_label: F.statusLabel(c.status, c.kind),
  claimant_id: Number(c.claimant_id), claimant_name: c.claimant_name, division_id: c.division_id === null ? null : Number(c.division_id),
  budget_id: Number(c.budget_id), category_id: Number(c.category_id), description: c.description, amount_cents: Number(c.amount_cents),
  expense_date: c.expense_date, vendor_name: c.vendor_name, due_date: c.due_date, payout_type: c.payout_type, payout_masked: c.payout_masked,
  rejection_reason: c.rejection_reason, payment_reference: c.payment_reference, paid_on: c.paid_on, created_at: c.created_at, updated_at: c.updated_at,
  budget_name: c.budget_name, category_name: c.category_name, division_name: c.division_name, items: c.items || null,
});
const CLAIM_COLS = `c.id, c.seq, c.kind, c.status, c.claimant_id, c.claimant_name, c.division_id, c.budget_id, c.category_id, c.description,
  c.amount_cents, c.expense_date::text as expense_date, c.vendor_name, c.due_date::text as due_date, c.payout_type, c.payout_masked,
  c.rejection_reason, c.payment_reference, c.paid_on::text as paid_on, c.created_at, c.updated_at, c.items,
  b.name as budget_name, k.name as category_name, u.name as division_name`;
const CLAIM_FROM = `fin_claims c join fin_budgets b on b.id = c.budget_id join fin_categories k on k.id = c.category_id left join org_units u on u.id = c.division_id`;

const canSee = (me, c) => Number(c.claimant_id) === me.memberId || me.inPurview(c.division_id);
function canDecide(me, c) {
  if (c.status === "pending_review") return Number(c.claimant_id) !== me.memberId && me.inPurview(c.division_id);
  if (c.status === "pending_finance") return me.finance;
  return false;
}

async function balanceOf(q, accountId) {
  const [r] = await q(`select coalesce(sum(amount_cents), 0)::bigint as bal, min(entry_date) filter (where kind = 'opening')::text as opened from fin_bank_entries where account_id = $1`, [accountId]);
  return { balance: Number(r.bal), opened: r.opened };
}
// an open account, and a date it can take an entry on (not before its opening balance, not in the future)
async function checkAccountDate(q, accountId, date) {
  const [a] = await q(`select * from fin_bank_accounts where id = $1`, [accountId]);
  if (!a || !a.active) return { error: "account_closed" };
  const { opened } = await balanceOf(q, accountId);
  if (date > F.todaySG()) return { error: "future_date" };
  if (opened && date < opened) return { error: "before_opening" };
  return { account: a };
}

// for finance setup: can the import run, and when it last did
async function importStatus(q) {
  const [row] = await q(`select value from settings where key = 'finance_import'`);
  let last = null;
  try { const v = row ? JSON.parse(row.value) : null; last = v && v.at ? { at: v.at, by: v.by } : null; } catch { last = null; }
  return { ready: Boolean(FI.config()), last };
}

module.exports = async function handler(req, res) {
  const user = await auth.guard(req, res);
  if (!user) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });
  const me = await F.whoIs(q, user);
  const fail = (status, error, extra = {}) => res.status(status).json({ error, ...extra });
  const financeOnly = () => (me.finance ? false : (fail(403, "not_allowed"), true));

  if (req.method === "GET") {
    const v = req.query.view;

    if (v === "me") {
      const [saved] = me.memberId ? await q(`select payout_type, payout_masked from fin_saved_payouts where member_id = $1`, [me.memberId]) : [];
      const rules = await q(`select id, title, body, applies_to, link_label, link_url from fin_rules where active order by sort, id`);
      const divisions = (await q(`select id, name from org_units where kind = 'division' order by sort, lower(name)`)).map((d) => ({ id: Number(d.id), name: d.name }));
      return res.status(200).json({
        finance: me.finance, leads: [...me.leads], isLead: me.isLead, canInvoice: me.finance || me.isLead, memberId: me.memberId,
        keyReady: F.keyReady(), saved: saved || null, rules, groups: F.GROUPS, divisions,
      });
    }

    if (v === "claims") {
      const scope = String(req.query.scope || "mine");
      const params = [];
      const p = (x) => { params.push(x); return `$${params.length}`; };
      const where = [];
      if (scope === "mine") where.push(`c.claimant_id = ${p(me.memberId || 0)}`);
      else if (scope === "review") {
        const parts = [];
        if (me.finance) parts.push(`c.status = 'pending_finance'`, `c.status = 'pending_review' and c.claimant_id <> ${p(me.memberId || 0)}`);
        else if (me.isLead) parts.push(`c.status = 'pending_review' and c.claimant_id <> ${p(me.memberId || 0)} and c.division_id = any(${p([...me.leads])}::bigint[])`);
        where.push(parts.length ? `(${parts.map((x) => `(${x})`).join(" or ")})` : "false");
      } else if (scope === "all") {
        if (!me.finance) where.push(me.isLead ? `c.division_id = any(${p([...me.leads])}::bigint[])` : "false");
      } else if (scope === "disburse") {
        if (!me.finance) return fail(403, "not_allowed");
        where.push(`c.status = 'approved'`);
      } else if (scope === "budget") {
        const [bud] = await q(`select division_id, is_reserve from fin_budgets where id = $1`, [idOf(req.query.budget) || 0]);
        if (!bud || !(me.finance || (!bud.is_reserve && me.inPurview(bud.division_id)))) return fail(403, "not_allowed");
        where.push(`c.budget_id = ${p(idOf(req.query.budget))}`);
      } else return fail(400, "bad_request");
      if (req.query.status) where.push(`c.status = ${p(String(req.query.status))}`);
      const text = String(req.query.q || "").trim().slice(0, 100);
      if (text) where.push(`(c.description ilike ${p(like(text))} or c.claimant_name ilike $${params.length} or coalesce(c.vendor_name,'') ilike $${params.length} or b.name ilike $${params.length})`);
      const rows = await q(`select ${CLAIM_COLS} from ${CLAIM_FROM} where ${where.join(" and ") || "true"} order by c.created_at desc limit 1000`, params);
      return res.status(200).json({ claims: rows.map(claimOut), statuses: F.STATUS });
    }

    if (v === "claim") {
      const [c] = await q(`select ${CLAIM_COLS} from ${CLAIM_FROM} where c.id = $1`, [idOf(req.query.id) || 0]);
      if (!c || !canSee(me, c)) return fail(404, "not_found");
      const files = (await q(`select id, name, type, size from fin_files where claim_id = $1 order by id`, [c.id])).map((f) => ({ ...f, id: Number(f.id) }));
      const out = { claim: claimOut(c), files, canDecide: canDecide(me, c), canPay: me.finance && c.status === "approved", finance: me.finance };
      // line items (claims copied from the finance app can have them), with their categories' names
      if (Array.isArray(c.items) && c.items.length) {
        const names = new Map((await q(`select id, name from fin_categories`)).map((k) => [Number(k.id), k.name]));
        out.claim.items = c.items.map((i) => ({ ...i, category_name: i.category_id ? names.get(Number(i.category_id)) || null : null }));
      }
      if (me.finance && ["pending_finance", "approved"].includes(c.status)) {
        const [t] = await F.budgetTotals(q, [c.budget_id]);
        // a short balance never blocks a claim; Finance is told instead
        out.budget_available_cents = t.available_cents - (c.status === "pending_finance" ? Number(c.amount_cents) : 0);
      }
      return res.status(200).json(out);
    }

    if (v === "file") {
      const [f] = await q(`select f.*, c.claimant_id, c.division_id from fin_files f left join fin_claims c on c.id = f.claim_id where f.id = $1`, [idOf(req.query.id) || 0]);
      if (!f || !(Number(f.owner_id) === me.memberId || (f.claim_id && canSee(me, f)))) return fail(404, "not_found");
      res.setHeader("Content-Type", f.type);
      res.setHeader("Content-Disposition", `inline; filename="${String(f.name).replace(/[^\w. -]/g, "_")}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(Buffer.from(f.data));
    }

    if (v === "payout") {
      if (financeOnly()) return;
      const [c] = await q(`select * from fin_claims where id = $1`, [idOf(req.query.id) || 0]);
      if (!c) return fail(404, "not_found");
      if (!["pending_finance", "approved"].includes(c.status)) return fail(409, "not_payable");
      if (!c.payout_enc) return fail(409, "no_payout");
      let d;
      try { d = F.decryptPayout(c.payout_enc, c.claimant_id); } catch { return fail(500, "payout_unreadable"); }
      const reference = F.payRef(c.seq);
      let qr = null;
      if (d.type !== "bank") {
        const payload = F.payNowPayload({ proxyType: d.type === "paynow_uen" ? "uen" : "mobile", proxy: d.proxy, amountCents: Number(c.amount_cents), payeeName: d.name, reference });
        qr = await QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      }
      return res.status(200).json({ details: d, reference, qr });
    }

    if (v === "budgets") {
      const all = await F.budgetTotals(q);
      const cats = await q(`select id, name, grp from fin_categories where active order by sort, lower(name)`);
      const prov = await q(`select g.budget_id, g.category_id from fin_guidelines g`);
      const divs = new Map((await q(`select id, name from org_units where kind = 'division'`)).map((d) => [Number(d.id), d.name]));
      const out = all.filter((b) => (b.is_reserve ? me.finance : b.active || me.inPurview(b.division_id))).map((b) => {
        const categories = b.is_reserve ? cats : cats.filter((k) => prov.some((g) => Number(g.budget_id) === b.id && Number(g.category_id) === Number(k.id)));
        const base = { id: b.id, name: b.name, kind: b.kind, division_id: b.division_id, division_name: divs.get(b.division_id) || null, is_reserve: b.is_reserve, active: b.active,
          categories: categories.map((k) => ({ id: Number(k.id), name: k.name, grp: k.grp })) };
        // amounts only for the division's leads and Finance
        return me.inPurview(b.division_id) || (b.is_reserve && me.finance) ? { ...b, ...base, figures: true } : base;
      });
      return res.status(200).json({ budgets: out, groups: F.GROUPS });
    }

    if (v === "budget") {
      const [b] = await F.budgetTotals(q, [idOf(req.query.id) || 0]);
      if (!b || !(b.is_reserve ? me.finance : me.inPurview(b.division_id))) return fail(404, "not_found");
      const guidelines = await q(
        `select k.id as category_id, k.name, k.grp, coalesce(g.guideline_cents, 0)::bigint as guideline_cents, (g.budget_id is not null) as provided,
                coalesce(sum(c.amount_cents) filter (where c.status in ('pending_review', 'pending_finance')), 0)::bigint as pending_cents,
                coalesce(sum(c.amount_cents) filter (where c.status = 'approved'), 0)::bigint as approved_cents,
                coalesce(sum(c.amount_cents) filter (where c.status = 'paid'), 0)::bigint as paid_cents
           from fin_categories k
           left join fin_guidelines g on g.category_id = k.id and g.budget_id = $1
           left join fin_claims c on c.category_id = k.id and c.budget_id = $1
          group by k.id, k.name, k.grp, k.sort, g.guideline_cents, g.budget_id
          order by k.sort, lower(k.name)`,
        [b.id]
      );
      const funds = b.is_reserve
        ? (await q(`select id, 'addition' as kind, amount_cents, added_on::text as entry_date, note, actor from fin_reserve_additions order by added_on desc, id desc`))
        : (await q(`select id, kind, amount_cents, entry_date::text as entry_date, note, actor from fin_funds where budget_id = $1 order by entry_date desc, id desc`, [b.id]));
      const [div] = b.division_id ? await q(`select name from org_units where id = $1`, [b.division_id]) : [];
      return res.status(200).json({
        budget: { ...b, division_name: div ? div.name : null },
        guidelines: guidelines.filter((g) => g.provided || Number(g.pending_cents) + Number(g.approved_cents) + Number(g.paid_cents) > 0 || b.is_reserve)
          .map((g) => ({ ...g, category_id: Number(g.category_id), guideline_cents: Number(g.guideline_cents), pending_cents: Number(g.pending_cents), approved_cents: Number(g.approved_cents), paid_cents: Number(g.paid_cents) })),
        allCategories: me.finance ? guidelines.map((g) => ({ id: Number(g.category_id), name: g.name, grp: g.grp, provided: g.provided, guideline_cents: Number(g.guideline_cents) })) : undefined,
        funds: funds.map((f) => ({ ...f, id: Number(f.id), amount_cents: Number(f.amount_cents) })),
        accounts: me.finance ? (await q(`select id, name, last4 from fin_bank_accounts where active order by lower(name)`)).map((a) => ({ ...a, id: Number(a.id) })) : undefined,
        groups: F.GROUPS, finance: me.finance,
      });
    }

    if (v === "setup") {
      if (financeOnly()) return;
      return res.status(200).json({
        categories: (await q(`select id, name, grp, active, sort from fin_categories order by sort, lower(name)`)).map((k) => ({ ...k, id: Number(k.id) })),
        rules: (await q(`select * from fin_rules order by sort, id`)).map((r) => ({ ...r, id: Number(r.id) })),
        divisions: (await q(`select id, name from org_units where kind = 'division' order by sort, lower(name)`)).map((d) => ({ id: Number(d.id), name: d.name })),
        groups: F.GROUPS, keyReady: F.keyReady(),
        ...(user.role === "master" ? { import: await importStatus(q) } : {}),
      });
    }

    if (v === "bank") {
      if (financeOnly()) return;
      const accounts = await q(
        `select a.id, a.name, a.bank, a.last4, a.active, coalesce(sum(e.amount_cents), 0)::bigint as balance_cents,
                min(e.entry_date) filter (where e.kind = 'opening')::text as opened_on
           from fin_bank_accounts a left join fin_bank_entries e on e.account_id = a.id
          group by a.id order by a.active desc, lower(a.name)`
      );
      const accountId = idOf(req.query.account);
      const entries = await q(
        `select e.id, e.account_id, e.kind, e.amount_cents, e.entry_date::text as entry_date, e.note, e.claim_id, e.actor, e.created_at, c.seq as claim_seq
           from fin_bank_entries e left join fin_claims c on c.id = e.claim_id
          where ($1::bigint is null or e.account_id = $1) order by e.entry_date desc, e.id desc limit 300`,
        [accountId]
      );
      return res.status(200).json({
        accounts: accounts.map((a) => ({ ...a, id: Number(a.id), balance_cents: Number(a.balance_cents) })),
        entries: entries.map((e) => ({ ...e, id: Number(e.id), account_id: Number(e.account_id), amount_cents: Number(e.amount_cents), claim_id: e.claim_id === null ? null : Number(e.claim_id), claim_code: e.claim_seq ? F.claimCode(e.claim_seq) : null })),
      });
    }

    if (v === "export") {
      if (financeOnly()) return;
      const rows = await q(`select ${CLAIM_COLS}, k.grp from ${CLAIM_FROM} order by c.created_at`);
      const head = ["claim", "submitted", "kind", "status", "claimant", "division", "budget", "category", "category_group", "description", "vendor", "amount_sgd", "expense_date", "due_date", "paid_on", "payment_reference"];
      const lines = [head.join(","), ...rows.map((c) => [F.claimCode(c.seq), new Date(c.created_at).toISOString().slice(0, 10), c.kind, F.statusLabel(c.status, c.kind), c.claimant_name,
        c.division_name || (c.division_id === null ? "Reserve" : ""), c.budget_name, c.category_name, F.GROUPS[c.grp] || "", c.description, c.vendor_name || "",
        (Number(c.amount_cents) / 100).toFixed(2), c.expense_date || "", c.due_date || "", c.paid_on || "", c.payment_reference || ""].map(cell).join(","))];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="normal-claims-${F.todaySG()}.csv"`);
      return res.status(200).send("﻿" + lines.join("\r\n"));
    }
    return fail(400, "bad_request");
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed");
  }
  const b = auth.body(req);
  const a = b.action;

  /* ── copying the finance app's data in (Master Admins) ── */
  if (a === "import-check" || a === "import-run" || a === "import-receipts") {
    if (user.role !== "master") return fail(403, "not_allowed");
    const cfg = FI.config();
    if (!cfg) return fail(503, "import_not_set_up");
    try {
      if (a === "import-check") return res.status(200).json(await FI.check(q, cfg));
      if (a === "import-run") {
        const people = b.people && typeof b.people === "object" ? b.people : {};
        const divisions = b.divisions && typeof b.divisions === "object" ? b.divisions : {};
        const out = await FI.run(q, cfg, user, { people, divisions });
        await log(q, user, "imported", "import", null, "the finance app", [
          { field: "Claims", from: null, to: String(out.counts.claims) },
          ...(out.created.people.length ? [{ field: "Members added", from: null, to: out.created.people.join(", ") }] : []),
          ...(out.created.divisions.length ? [{ field: "Divisions added", from: null, to: out.created.divisions.join(", ") }] : []),
          ...(out.financeTeam.length ? [{ field: "Finance team", from: null, to: out.financeTeam.join(", ") }] : []),
        ]);
        return res.status(200).json(out);
      }
      const skip = Array.isArray(b.skip) ? b.skip.map(String).slice(0, 1000) : [];
      return res.status(200).json(await FI.receipts(q, cfg, skip));
    } catch (e) {
      if (e && ["import_unreachable", "import_denied", "import_key", "payout_key"].includes(e.code)) return fail(e.code === "payout_key" ? 503 : 502, e.code);
      throw e;
    }
  }

  /* ── receipts ── */
  if (a === "upload") {
    if (!me.memberId) return fail(403, "link_member");
    const type = String(b.type || "");
    if (!FILE_TYPES.includes(type)) return fail(400, "bad_file_type");
    const data = Buffer.from(String(b.data || ""), "base64");
    if (!data.length || data.length > MAX_FILE) return fail(400, "file_too_big");
    const name = clip(b.name, 120).replace(/[\\/]/g, "_") || "receipt";
    const [f] = await q(`insert into fin_files (owner_id, name, type, size, data) values ($1, $2, $3, $4, $5) returning id`, [me.memberId, name, type, data.length, data]);
    return res.status(201).json({ id: Number(f.id), name, type, size: data.length });
  }

  /* ── a claim ── */
  if (a === "submit") {
    if (!me.memberId) return fail(403, "link_member");
    if (!F.keyReady()) return fail(503, "payout_key");
    const submission = clip(b.submissionId, 64);
    if (submission.length < 8) return fail(400, "bad_request");
    // a retried submission (the answer got lost): hand back the claim already made
    const [already] = await q(`select id, seq, status from fin_claims where claimant_id = $1 and submission_id = $2`, [me.memberId, submission]);
    if (already) return res.status(200).json({ id: Number(already.id), code: F.claimCode(already.seq), status: already.status });
    const kind = b.kind === "invoice" ? "invoice" : "reimbursement";
    if (kind === "invoice" && !(me.finance || me.isLead)) return fail(403, "invoice_not_allowed");
    const [bud] = await q(`select * from fin_budgets where id = $1`, [idOf(b.budgetId) || 0]);
    if (!bud || !bud.active) return fail(400, "budget_closed");
    if (bud.is_reserve && !me.finance) return fail(403, "not_allowed");
    const [cat] = await q(
      `select k.id from fin_categories k where k.id = $1 and k.active and ($2 or exists (select 1 from fin_guidelines g where g.budget_id = $3 and g.category_id = k.id))`,
      [idOf(b.categoryId) || 0, bud.is_reserve, bud.id]
    );
    if (!cat) return fail(400, "bad_category");
    const description = clip(b.description, 500);
    if (description.length < 3) return fail(400, "need_description");
    const amount = F.toCents(b.amount);
    if (!amount || amount > 100000000) return fail(400, "bad_amount");
    const expenseDate = kind === "reimbursement" && b.expenseDate ? String(b.expenseDate) : null;
    if (expenseDate && (!isDate(expenseDate) || expenseDate > F.todaySG())) return fail(400, "bad_expense_date");
    const vendor = kind === "invoice" ? clip(b.vendorName, 120) : null;
    if (kind === "invoice" && !vendor) return fail(400, "need_vendor");
    const dueDate = kind === "invoice" && b.dueDate ? String(b.dueDate) : null;
    if (dueDate && !isDate(dueDate)) return fail(400, "bad_due_date");
    const fileIds = [...new Set((Array.isArray(b.fileIds) ? b.fileIds : []).map(idOf).filter(Boolean))];
    if (fileIds.length < 1 || fileIds.length > 5) return fail(400, "need_receipt");
    const own = await q(`select id from fin_files where id = any($1::bigint[]) and owner_id = $2 and claim_id is null`, [fileIds, me.memberId]);
    if (own.length !== fileIds.length) return fail(400, "bad_receipt");
    if (b.agreed !== true) return fail(400, "need_agreement");

    let payoutType, masked, enc;
    if (b.payout && b.payout.type === "saved") {
      if (kind === "invoice") return fail(400, "vendor_payout");
      const [saved] = await q(`select * from fin_saved_payouts where member_id = $1`, [me.memberId]);
      if (!saved) return fail(400, "need_payout");
      try { F.decryptPayout(saved.payout_enc, me.memberId); } catch {
        await q(`delete from fin_saved_payouts where member_id = $1`, [me.memberId]);
        return fail(400, "saved_payout_unreadable");
      }
      ({ payout_type: payoutType, payout_masked: masked, payout_enc: enc } = saved);
    } else {
      const p = F.payoutFrom(b.payout || {});
      if (p.error) return fail(400, "bad_payout", { message: p.error });
      payoutType = p.details.type;
      masked = F.maskPayout(p.details);
      enc = F.encryptPayout(p.details, me.memberId);
      if (b.savePayout === true && kind === "reimbursement") {
        await q(`insert into fin_saved_payouts (member_id, payout_type, payout_masked, payout_enc) values ($1, $2, $3, $4)
                 on conflict (member_id) do update set payout_type = excluded.payout_type, payout_masked = excluded.payout_masked, payout_enc = excluded.payout_enc, updated_at = now()`,
        [me.memberId, payoutType, masked, enc]);
      }
    }

    const [person] = await q(`select name from members where id = $1`, [me.memberId]);
    const status = me.finance || me.isLead ? "pending_finance" : "pending_review";
    let row;
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      try {
        [row] = await q(
          `insert into fin_claims (seq, kind, status, claimant_id, claimant_name, division_id, budget_id, category_id, description, amount_cents,
                                   expense_date, vendor_name, due_date, payout_type, payout_masked, payout_enc, submission_id)
           values ((select coalesce(max(seq), 0) + 1 from fin_claims), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           on conflict (claimant_id, submission_id) do nothing returning id, seq`,
          [kind, status, me.memberId, person ? person.name : me.name, bud.division_id, bud.id, cat.id, description, amount, expenseDate, vendor, dueDate, payoutType, masked, enc, submission]
        );
        if (!row) {
          // a retried submission: hand back the claim already made
          const [existing] = await q(`select id, seq from fin_claims where claimant_id = $1 and submission_id = $2`, [me.memberId, submission]);
          return res.status(200).json({ id: Number(existing.id), code: F.claimCode(existing.seq), status });
        }
      } catch (e) {
        if (attempt === 2) throw e; // two claims sent at the same moment: take the next number
      }
    }
    await q(`update fin_files set claim_id = $1 where id = any($2::bigint[]) and owner_id = $3 and claim_id is null`, [row.id, fileIds, me.memberId]);
    await log(q, user, "submitted", "claim", row.id, `${F.claimCode(row.seq)} ${description}`, [{ field: "Amount", from: null, to: `S$${(amount / 100).toFixed(2)}` }, { field: "Status", from: null, to: F.STATUS[status] }]);
    return res.status(201).json({ id: Number(row.id), code: F.claimCode(row.seq), status });
  }

  if (a === "decide") {
    const [c] = await q(`select * from fin_claims where id = $1`, [idOf(b.id) || 0]);
    if (!c || !canSee(me, c)) return fail(404, "not_found");
    if (!["pending_review", "pending_finance"].includes(c.status)) return fail(409, "already_decided");
    if (!canDecide(me, c)) return fail(403, "cant_decide");
    const approve = b.approve === true;
    const reason = clip(b.reason, 500);
    if (!approve && reason.length < 3) return fail(400, "need_reason");
    const next = approve ? (c.status === "pending_review" ? "pending_finance" : "approved") : "rejected";
    const [done] = await q(
      `update fin_claims set status = $3, rejection_reason = $4, updated_at = now() where id = $1 and status = $2 returning id`,
      [c.id, c.status, next, approve ? null : reason]
    );
    if (!done) return fail(409, "already_decided");
    const action = !approve ? "rejected" : next === "pending_finance" ? "reviewed" : "approved";
    await log(q, user, action, "claim", c.id, `${F.claimCode(c.seq)} ${c.description}`, [{ field: "Status", from: F.statusLabel(c.status, c.kind), to: F.statusLabel(next, c.kind) }], approve ? null : reason);
    return res.status(200).json({ status: next });
  }

  if (a === "pay") {
    if (financeOnly()) return;
    const [c] = await q(`select * from fin_claims where id = $1`, [idOf(b.id) || 0]);
    if (!c) return fail(404, "not_found");
    if (c.status !== "approved") return fail(409, "not_approved");
    const reference = clip(b.reference, 100);
    if (reference.length < 3) return fail(400, "need_reference");
    const date = isDate(b.date) ? b.date : F.todaySG();
    const chk = await checkAccountDate(q, idOf(b.accountId) || 0, date);
    if (chk.error) return fail(400, chk.error);
    const [done] = await q(`update fin_claims set status = 'paid', payment_reference = $2, paid_on = $3, updated_at = now() where id = $1 and status = 'approved' returning id`, [c.id, reference, date]);
    if (!done) return fail(409, "not_approved");
    await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, claim_id, actor) values ($1, 'payout', $2, $3, $4, $5, $6)`,
      [chk.account.id, -Number(c.amount_cents), date, `${c.claimant_name} · ${reference}`.slice(0, 300), c.id, user.username]);
    await log(q, user, "disbursed", "claim", c.id, `${F.claimCode(c.seq)} ${c.description}`, [{ field: "Status", from: F.statusLabel("approved", c.kind), to: F.statusLabel("paid", c.kind) }], `Reference ${reference}`);
    return res.status(200).json({ ok: true });
  }

  /* ── everything below is Finance's ── */
  if (financeOnly()) return;
  const day = isDate(b.date) ? b.date : F.todaySG();
  if (day > F.todaySG()) return fail(400, "future_date");

  if (a === "budget") {
    const id = idOf(b.id);
    const [cur] = id ? await q(`select * from fin_budgets where id = $1`, [id]) : [];
    if (id && !cur) return fail(404, "not_found");
    const name = clip(b.name, 100);
    if (!name && !cur?.is_reserve) return fail(400, "need_name");
    const kind = b.kind === "general" ? "general" : "event";
    let divisionId = cur && cur.is_reserve ? null : idOf(b.divisionId);
    if (!(cur && cur.is_reserve)) {
      const [div] = divisionId ? await q(`select id from org_units where id = $1 and kind = 'division'`, [divisionId]) : [];
      if (!div) return fail(400, "need_division");
    }
    if (cur && Number(cur.division_id) !== divisionId && !cur.is_reserve) {
      const [has] = await q(`select 1 from fin_claims where budget_id = $1 limit 1`, [cur.id]);
      if (has) return fail(409, "budget_has_claims");
    }
    const guidelines = (Array.isArray(b.guidelines) ? b.guidelines : []).map((g) => ({ category_id: idOf(g.categoryId), cents: g.amount === "" || g.amount === undefined ? 0 : F.toCents(g.amount) ?? (Number(g.amount) === 0 ? 0 : -1) }));
    if (guidelines.some((g) => !g.category_id || g.cents < 0)) return fail(400, "bad_guideline");
    const committed = b.committed === "" || b.committed === undefined ? 0 : F.toCents(b.committed) ?? 0;
    let budgetId = id;
    if (cur) {
      await q(`update fin_budgets set name = $2, kind = $3, division_id = $4, active = $5, grant_committed_cents = $6 where id = $1`,
        [id, cur.is_reserve ? cur.name : name, kind, divisionId, cur.is_reserve ? true : b.active !== false, committed]);
    } else {
      [{ id: budgetId }] = await q(`insert into fin_budgets (name, kind, division_id, grant_committed_cents) values ($1, $2, $3, $4) returning id`, [name, kind, divisionId, committed]);
    }
    if (!(cur && cur.is_reserve)) {
      // a category with claims stays provided
      const used = (await q(`select distinct category_id from fin_claims where budget_id = $1`, [budgetId])).map((r) => Number(r.category_id));
      const keep = new Set(guidelines.map((g) => g.category_id));
      const dropped = used.filter((k) => !keep.has(k));
      if (dropped.length) return fail(409, "category_has_claims");
      await q(`delete from fin_guidelines where budget_id = $1`, [budgetId]);
      for (const g of guidelines) await q(`insert into fin_guidelines (budget_id, category_id, guideline_cents) values ($1, $2, $3)`, [budgetId, g.category_id, g.cents]);
    }
    await log(q, user, cur ? "updated" : "created", "budget", budgetId, cur && cur.is_reserve ? "Reserve" : name);
    return res.status(cur ? 200 : 201).json({ id: Number(budgetId) });
  }

  if (a === "category") {
    const name = clip(b.name, 60);
    if (!name) return fail(400, "need_name");
    if (!F.GROUPS[b.group]) return fail(400, "need_group");
    const id = idOf(b.id);
    try {
      if (id) await q(`update fin_categories set name = $2, grp = $3, active = $4 where id = $1`, [id, name, b.group, b.active !== false]);
      else await q(`insert into fin_categories (name, grp, sort) values ($1, $2, (select coalesce(max(sort), 0) + 1 from fin_categories))`, [name, b.group]);
    } catch { return fail(409, "category_exists"); }
    return res.status(200).json({ ok: true });
  }

  if (a === "rule") {
    const title = clip(b.title, 120), body = clip(b.body, 2000);
    if (!title || !body) return fail(400, "need_rule");
    const url = clip(b.linkUrl, 300);
    if (url && !/^https:\/\/\S+$/.test(url)) return fail(400, "bad_rule_link");
    const appliesTo = ["all", "reimbursement", "invoice"].includes(b.appliesTo) ? b.appliesTo : "all";
    const vals = [title, body, appliesTo, clip(b.linkLabel, 60) || null, url || null, Number(b.sort) || 0, b.active !== false];
    const id = idOf(b.id);
    if (id) await q(`update fin_rules set title = $2, body = $3, applies_to = $4, link_label = $5, link_url = $6, sort = $7, active = $8 where id = $1`, [id, ...vals]);
    else await q(`insert into fin_rules (title, body, applies_to, link_label, link_url, sort, active) values ($1, $2, $3, $4, $5, $6, $7)`, vals);
    return res.status(200).json({ ok: true });
  }
  if (a === "rule-delete") {
    await q(`delete from fin_rules where id = $1`, [idOf(b.id) || 0]);
    return res.status(200).json({ ok: true });
  }

  if (a === "account") {
    const name = clip(b.name, 80), last4 = String(b.last4 || "").trim();
    if (!name) return fail(400, "need_name");
    if (!/^\d{4}$/.test(last4)) return fail(400, "need_last4");
    const opening = b.opening === "0" || b.opening === 0 ? 0 : F.toCents(b.opening);
    if (opening === null) return fail(400, "bad_amount");
    let acc;
    try { [acc] = await q(`insert into fin_bank_accounts (name, bank, last4) values ($1, $2, $3) returning id`, [name, clip(b.bank, 40) || "DBS", last4]); } catch { return fail(409, "account_exists"); }
    await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, actor) values ($1, 'opening', $2, $3, 'Opening balance', $4)`, [acc.id, opening, day, user.username]);
    await log(q, user, "created", "bank", acc.id, `${name} ••${last4}`);
    return res.status(201).json({ id: Number(acc.id) });
  }
  if (a === "account-close") {
    await q(`update fin_bank_accounts set active = $2 where id = $1`, [idOf(b.id) || 0, b.active === true]);
    return res.status(200).json({ ok: true });
  }

  if (a === "entry") {
    // money in (a grant or other income) or a correction to match the bank; both need a note
    const kind = b.kind === "adjustment" ? "adjustment" : "grant";
    const raw = String(b.amount || "").trim();
    const neg = kind === "adjustment" && raw.startsWith("-");
    const cents = F.toCents(raw.replace(/^-/, ""));
    if (!cents) return fail(400, "bad_amount");
    const note = clip(b.note, 300);
    if (note.length < 3) return fail(400, "need_note");
    const chk = await checkAccountDate(q, idOf(b.accountId) || 0, day);
    if (chk.error) return fail(400, chk.error);
    if (b.expectedBalance !== undefined && b.expectedBalance !== null) {
      const { balance } = await balanceOf(q, chk.account.id);
      if (balance !== Number(b.expectedBalance)) return fail(409, "balance_changed");
    }
    await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, actor) values ($1, $2, $3, $4, $5, $6)`, [chk.account.id, kind, neg ? -cents : cents, day, note, user.username]);
    await log(q, user, kind === "grant" ? "recorded money in" : "adjusted", "bank", chk.account.id, chk.account.name, [{ field: "Amount", from: null, to: `${neg ? "-" : ""}S$${(cents / 100).toFixed(2)}` }], note);
    return res.status(201).json({ ok: true });
  }

  if (a === "transfer") {
    const cents = F.toCents(b.amount);
    if (!cents) return fail(400, "bad_amount");
    const from = await checkAccountDate(q, idOf(b.from) || 0, day);
    const to = await checkAccountDate(q, idOf(b.to) || 0, day);
    if (from.error || to.error) return fail(400, from.error || to.error);
    if (from.account.id === to.account.id) return fail(400, "same_account");
    const tid = require("crypto").randomUUID();
    const note = clip(b.note, 300) || `Transfer: ${from.account.name} → ${to.account.name}`;
    await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, transfer_id, actor) values ($1, 'transfer_out', $2, $3, $4, $5, $6)`, [from.account.id, -cents, day, note, tid, user.username]);
    await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, transfer_id, actor) values ($1, 'transfer_in', $2, $3, $4, $5, $6)`, [to.account.id, cents, day, note, tid, user.username]);
    await log(q, user, "transferred", "bank", from.account.id, `${from.account.name} → ${to.account.name}`, [{ field: "Amount", from: null, to: `S$${(cents / 100).toFixed(2)}` }]);
    return res.status(201).json({ ok: true });
  }

  if (["grant", "loan", "repay", "reserve-add"].includes(a)) {
    const cents = F.toCents(b.amount);
    if (!cents) return fail(400, "bad_amount");
    const note = clip(b.note, 300);
    if (a === "reserve-add") {
      if (note.length < 3) return fail(400, "need_note");
      await q(`insert into fin_reserve_additions (amount_cents, added_on, note, actor) values ($1, $2, $3, $4)`, [cents, day, note, user.username]);
      await log(q, user, "added to the reserve", "budget", null, "Reserve", [{ field: "Amount", from: null, to: `S$${(cents / 100).toFixed(2)}` }], note);
      return res.status(201).json({ ok: true });
    }
    const [bud] = await F.budgetTotals(q, [idOf(b.budgetId) || 0]);
    if (!bud || bud.is_reserve) return fail(400, "bad_budget");
    if (a === "grant") {
      // grant monies arrive in one of our accounts, and onto the budget's balance
      const chk = await checkAccountDate(q, idOf(b.accountId) || 0, day);
      if (chk.error) return fail(400, chk.error);
      const [e] = await q(`insert into fin_bank_entries (account_id, kind, amount_cents, entry_date, note, actor) values ($1, 'grant', $2, $3, $4, $5) returning id`,
        [chk.account.id, cents, day, note || `Grant for ${bud.name}`, user.username]);
      await q(`insert into fin_funds (budget_id, kind, amount_cents, entry_date, note, bank_entry_id, actor) values ($1, 'grant', $2, $3, $4, $5, $6)`, [bud.id, cents, day, note || null, e.id, user.username]);
    } else if (a === "loan") {
      const [reserve] = (await F.budgetTotals(q)).filter((x) => x.is_reserve);
      if (!reserve || reserve.available_cents < cents) return fail(400, "reserve_short", { available_cents: reserve ? reserve.available_cents : 0 });
      await q(`insert into fin_funds (budget_id, kind, amount_cents, entry_date, note, actor) values ($1, 'loan', $2, $3, $4, $5)`, [bud.id, cents, day, note || null, user.username]);
    } else {
      const owed = bud.loaned_cents - bud.repaid_cents;
      if (cents > owed) return fail(400, "repay_too_much", { owed_cents: owed });
      if (cents > bud.available_cents) return fail(400, "budget_short", { available_cents: bud.available_cents });
      await q(`insert into fin_funds (budget_id, kind, amount_cents, entry_date, note, actor) values ($1, 'repayment', $2, $3, $4, $5)`, [bud.id, cents, day, note || null, user.username]);
    }
    const label = { grant: "recorded a grant", loan: "lent from the reserve", repay: "repaid the reserve" }[a];
    await log(q, user, label, "budget", bud.id, bud.name, [{ field: "Amount", from: null, to: `S$${(cents / 100).toFixed(2)}` }], note || null);
    return res.status(201).json({ ok: true });
  }

  return fail(400, "bad_request");
};

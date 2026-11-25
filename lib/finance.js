// Finance: claims, budgets with spend guidelines, disbursements and the bank ledger.
// Ported from the-newnormal/finance (its CLAUDE.md is the reference for every rule here).
//
// Who's who, in portal terms:
//   Finance team    Master Admins, and accounts with the Finance flag (accounts page). Final approval,
//                   disbursements, the bank, budgets and setup.
//   Division lead   anyone with a Founder, Chief of Staff or Director seat on an org-chart division.
//                   Reviews (preliminary approval of) members' claims in that division and sees its
//                   budgets and spending. Can submit vendor invoices.
//   Everyone else   submits reimbursement claims and sees their own.
// A claim moves pending_review → pending_finance → approved → paid, or to rejected from either pending
// state. Members' claims start at pending_review; leads' and Finance's at pending_finance. Nobody reviews
// their own claim, except that Finance may finalise its own.

const crypto = require("crypto");

const GROUPS = {
  venue_production: "Venue & Production", programme: "Programme", people: "People",
  marketing: "Marketing & Brand", operations: "Operations & Admin",
};
const STATUS = {
  pending_review: "Awaiting review", pending_finance: "Awaiting Finance",
  approved: "Approved · to be disbursed", rejected: "Rejected", paid: "Reimbursed or settled",
};
const statusLabel = (status, kind) => {
  if (status === "paid") return kind === "invoice" ? "Settled" : "Reimbursed";
  if (status === "approved") return kind === "invoice" ? "Approved · to be settled" : "Approved · to be reimbursed";
  return STATUS[status];
};
const PAYOUT = { paynow_mobile: "PayNow (mobile)", paynow_uen: "PayNow (UEN)", bank: "Bank transfer" };
const LEAD_ROLES = ["Founder", "Chief of Staff", "Director"];

const todaySG = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const claimCode = (seq) => `C-${String(seq).padStart(4, "0")}`;
const payRef = (seq) => `NN-C${String(seq).padStart(5, "0")}`; // the PayNow / bank reference for a claim

// "S$1,234.50", "1234.5" → 123450, or null
function toCents(v) {
  const s = String(v ?? "").replace(/[S$,\s]/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

const isFinance = (u) => Boolean(u && (u.role === "master" || u.finance));

// the org-chart divisions this member leads
async function leadsOf(q, memberId) {
  if (!memberId) return new Set();
  const rows = await q(
    `select distinct s.unit_id from seats s join org_units u on u.id = s.unit_id
      where s.member_id = $1 and u.kind = 'division' and s.role = any($2::text[])`,
    [memberId, LEAD_ROLES]
  );
  return new Set(rows.map((r) => Number(r.unit_id)));
}

// everything the endpoint needs to know about the person asking
async function whoIs(q, user) {
  const leads = await leadsOf(q, user.memberId);
  const finance = isFinance(user);
  return {
    ...user, finance, leads,
    isLead: leads.size > 0,
    // sees a division's budgets, spending and claims: Finance always, leads for their divisions
    inPurview: (divisionId) => finance || (divisionId !== null && divisionId !== undefined && leads.has(Number(divisionId))),
  };
}

/* ───────────── payout details: AES-256-GCM, the claimant's member id as additional data ───────────── */

function key() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}
const keyReady = () => Boolean(key());

function encryptPayout(details, ownerId) {
  const k = key();
  if (!k) throw new Error("PAYOUT_ENCRYPTION_KEY is not set");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(String(ownerId), "utf8"));
  const data = Buffer.concat([c.update(JSON.stringify(details), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decryptPayout(token, ownerId) {
  const k = key();
  if (!k) throw new Error("PAYOUT_ENCRYPTION_KEY is not set");
  const [version, iv, tag, data, ...rest] = String(token).split(".");
  if (version !== "v1" || !iv || !tag || !data || rest.length) throw new Error("Unknown payout format");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"), { authTagLength: 16 });
  d.setAAD(Buffer.from(String(ownerId), "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8"));
}

// what everyone but Finance sees, e.g. "Mobile •••• 4567"
function maskPayout(d) {
  const last4 = (s = "") => "•••• " + String(s).replace(/\s/g, "").slice(-4);
  if (d.type === "bank") return `${d.bankName} ${last4(d.accountNumber)}`.slice(0, 60);
  return `${d.type === "paynow_uen" ? "UEN" : "Mobile"} ${last4(d.proxy)}`;
}

/* ───────────── PayNow (SGQR / EMVCo), as in the finance app's src/lib/paynow.ts ───────────── */

const UEN = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;
function normaliseUen(input) {
  const uen = String(input || "").replace(/\s/g, "").toUpperCase();
  return UEN.test(uen) ? uen : null;
}
function normaliseSgMobile(input) {
  if (!/^\+?[\d\s\-()]+$/.test(String(input || "").trim())) return null;
  const digits = String(input).replace(/\D/g, "").replace(/^65(?=\d{8}$)/, "");
  return /^[89]\d{7}$/.test(digits) ? `+65${digits}` : null;
}

// → { details } or { error }, from what the claim form sent
function payoutFrom(p) {
  const name = String((p && p.name) || "").trim();
  if (name.length < 2 || name.length > 70) return { error: "Enter the account holder's name." };
  if (p.type === "paynow_mobile") {
    const proxy = normaliseSgMobile(p.proxy);
    return proxy ? { details: { type: p.type, name, proxy } } : { error: "Enter a Singapore mobile number registered with PayNow." };
  }
  if (p.type === "paynow_uen") {
    const proxy = normaliseUen(p.proxy);
    return proxy ? { details: { type: p.type, name, proxy } } : { error: "Enter a valid UEN." };
  }
  if (p.type === "bank") {
    const bankName = String(p.bankName || "").trim();
    const accountNumber = String(p.accountNumber || "").replace(/[\s-]/g, "");
    if (bankName.length < 2 || bankName.length > 50) return { error: "Enter the bank." };
    return /^\d{6,17}$/.test(accountNumber) ? { details: { type: p.type, name, bankName, accountNumber } } : { error: "Enter the bank account number (digits only)." };
  }
  return { error: "Choose how to be paid." };
}

function tlv(id, value) {
  return id + String(value.length).padStart(2, "0") + value;
}
function crc16(input) {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const clean = (s, max) => String(s).normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim().slice(0, max);

function payNowPayload({ proxyType, proxy, amountCents, payeeName, reference, expiresInDays = 7 }) {
  const expiry = new Date(Date.now() + expiresInDays * 864e5 + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  const merchant = tlv("00", "SG.PAYNOW") + tlv("01", proxyType === "mobile" ? "0" : "2") + tlv("02", proxy) + tlv("03", "0") + tlv("04", expiry);
  const body = tlv("00", "01") + tlv("01", "12") + tlv("26", merchant) + tlv("52", "0000") + tlv("53", "702") +
    tlv("54", (amountCents / 100).toFixed(2)) + tlv("58", "SG") + tlv("59", clean(payeeName, 25) || "NA") + tlv("60", "Singapore") +
    tlv("62", tlv("01", clean(reference, 25).replace(/[^A-Za-z0-9-]/g, ""))) + "6304";
  return body + crc16(body);
}

/* ───────────── budget figures, computed from claims and funding (never stored) ───────────── */

// one row per budget (ids: limit to these), with what's been claimed, funded and is still available
async function budgetTotals(q, ids) {
  const rows = await q(
    `select b.*,
        coalesce((select sum(g.guideline_cents) from fin_guidelines g where g.budget_id = b.id), 0)::bigint as guideline_cents,
        coalesce((select sum(c.amount_cents) from fin_claims c where c.budget_id = b.id and c.status in ('pending_review', 'pending_finance')), 0)::bigint as pending_cents,
        coalesce((select sum(c.amount_cents) from fin_claims c where c.budget_id = b.id and c.status = 'approved'), 0)::bigint as approved_cents,
        coalesce((select sum(c.amount_cents) from fin_claims c where c.budget_id = b.id and c.status = 'paid'), 0)::bigint as paid_cents,
        coalesce((select sum(f.amount_cents) from fin_funds f where f.budget_id = b.id and f.kind = 'grant'), 0)::bigint as granted_cents,
        coalesce((select sum(f.amount_cents) from fin_funds f where f.budget_id = b.id and f.kind = 'loan'), 0)::bigint as loaned_cents,
        coalesce((select sum(f.amount_cents) from fin_funds f where f.budget_id = b.id and f.kind = 'repayment'), 0)::bigint as repaid_cents
       from fin_budgets b ${ids ? "where b.id = any($1::bigint[])" : ""} order by b.is_reserve desc, b.active desc, lower(b.name)`,
    ids ? [ids] : []
  );
  const [{ added }] = await q(`select coalesce(sum(amount_cents), 0)::bigint as added from fin_reserve_additions`);
  const [{ lent }] = await q(`select (coalesce(sum(amount_cents) filter (where kind = 'loan'), 0) - coalesce(sum(amount_cents) filter (where kind = 'repayment'), 0))::bigint as lent from fin_funds`);
  return rows.map((r) => {
    const n = (k) => Number(r[k]);
    const out = {
      id: Number(r.id), name: r.name, kind: r.kind, division_id: r.division_id === null ? null : Number(r.division_id),
      is_reserve: r.is_reserve, active: r.active, grant_committed_cents: Number(r.grant_committed_cents),
      guideline_cents: n("guideline_cents"), pending_cents: n("pending_cents"), approved_cents: n("approved_cents"), paid_cents: n("paid_cents"),
      granted_cents: n("granted_cents"), loaned_cents: n("loaned_cents"), repaid_cents: n("repaid_cents"),
    };
    if (r.is_reserve) {
      out.funded_cents = Number(added);
      out.lent_out_cents = Number(lent);
      out.available_cents = Number(added) - Number(lent) - out.approved_cents - out.paid_cents;
    } else {
      out.available_cents = out.granted_cents + out.loaned_cents - out.repaid_cents - out.approved_cents - out.paid_cents;
    }
    return out;
  });
}

module.exports = {
  GROUPS, STATUS, PAYOUT, LEAD_ROLES, statusLabel, todaySG, claimCode, payRef, toCents, isFinance, leadsOf, whoIs,
  keyReady, encryptPayout, decryptPayout, maskPayout, normaliseUen, normaliseSgMobile, payoutFrom, payNowPayload, budgetTotals,
};

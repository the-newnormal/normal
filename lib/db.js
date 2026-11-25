// The database: Postgres via Vercel's Neon add-on, which sets DATABASE_URL.
// Tables are created (and new columns added) automatically the first time they're needed.

let query = null;
let ready = null;

function connect() {
  if (query) return query;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  const { neon } = require("@neondatabase/serverless");
  const sql = neon(url);
  query = (text, params = []) => sql.query(text, params);
  return query;
}

const SCHEMA = [
  // recruitment applications from join.html
  `create table if not exists applications (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    name        text not null,
    phone       text,
    telegram    text,
    dob         date,
    life_stage  text,
    school      text,
    answers     jsonb not null
  )`,
  `alter table applications add column if not exists status text not null default 'new'`,
  `alter table applications add column if not exists member_id bigint`,
  `create index if not exists applications_created_at on applications (created_at desc)`,

  // everyone in Normal
  `create table if not exists members (
    id              bigserial primary key,
    name            text not null,
    title           text,
    round           text,
    telegram        text,
    phone           text,
    email           text,
    dob             date,
    school          text,
    joined_on       date,
    status          text not null default 'active',
    notes           text,
    application_id  bigint,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
  )`,

  // the org chart: divisions → domains → teams
  `create table if not exists org_units (
    id          bigserial primary key,
    kind        text not null check (kind in ('division', 'domain', 'team')),
    parent_id   bigint,
    name        text not null,
    code        text,
    overseers   bigint[] not null default '{}',
    note        text,
    sort        integer not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  )`,

  // who sits where on the org chart, and as what (someone can hold more than one seat)
  `create table if not exists seats (
    id         bigserial primary key,
    member_id  bigint not null,
    unit_id    bigint,
    role       text not null default 'Member',
    note       text,
    sort       integer not null default 0
  )`,
  `create index if not exists seats_member on seats (member_id)`,
  `create index if not exists seats_unit on seats (unit_id)`,

  // who can sign in to the portal (Master Admins in ADMIN_USERS are not in here)
  `create table if not exists accounts (
    id                bigserial primary key,
    username          text not null unique,
    name              text not null,
    role              text not null check (role in ('master', 'admin', 'member')),
    password_hash     text,
    session_version   integer not null default 1,
    disabled          boolean not null default false,
    member_id         bigint,
    setup_token_hash  text,
    setup_expires     timestamptz,
    created_by        text,
    created_at        timestamptz not null default now(),
    last_login        timestamptz
  )`,
  // one login per member profile
  `create unique index if not exists accounts_member_id on accounts (member_id) where member_id is not null`,

  // the public "what's on" page
  `create table if not exists ips (
    id          bigserial primary key,
    name        text not null,
    theme       text,
    kicker      text,
    blurb       text,
    link        text,
    image       text,
    sort        integer not null default 0,
    visible     boolean not null default true,
    updated_at  timestamptz not null default now()
  )`,
  `create table if not exists events (
    id          bigserial primary key,
    title       text not null,
    date        date not null,
    time        text,
    place       text,
    blurb       text,
    link        text,
    recap       text,
    image       text,
    visible     boolean not null default true,
    updated_at  timestamptz not null default now()
  )`,

  // every other module (tasks, events & projects, meetings, partners, finance, library, announcements):
  // one row per record, its fields in data. Modules are defined in lib/collections.js.
  `create table if not exists records (
    id          bigserial primary key,
    collection  text not null,
    seq         integer not null,
    data        jsonb not null default '{}'::jsonb,
    archived    boolean not null default false,
    created_by  text,
    created_at  timestamptz not null default now(),
    updated_by  text,
    updated_at  timestamptz not null default now()
  )`,
  `create unique index if not exists records_collection_seq on records (collection, seq)`,

  // the audit trail, and notes people leave on any record
  `create table if not exists activity (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    actor       text,
    actor_name  text,
    action      text not null,
    kind        text not null,
    ref_id      bigint,
    label       text,
    changes     jsonb,
    note        text
  )`,
  `create index if not exists activity_ref on activity (kind, ref_id, at desc)`,
  `create index if not exists activity_at on activity (at desc)`,

  // ── finance (ported from the-newnormal/finance; money is in cents) ──
  // who's on the Finance team (Master Admins always are)
  `alter table accounts add column if not exists finance boolean not null default false`,
  // spend categories, each in one of five groups (Venue & Production, Programme, People, Marketing & Brand, Operations & Admin)
  `create table if not exists fin_categories (
    id      bigserial primary key,
    name    text not null unique,
    grp     text not null check (grp in ('venue_production', 'programme', 'people', 'marketing', 'operations')),
    active  boolean not null default true,
    sort    integer not null default 0
  )`,
  // budgets live in an org-chart division (the reserve in none); each provides some categories, with a guideline amount each
  `create table if not exists fin_budgets (
    id                     bigserial primary key,
    name                   text not null,
    kind                   text not null default 'event' check (kind in ('event', 'general')),
    division_id            bigint,
    project_id             bigint,
    is_reserve             boolean not null default false,
    active                 boolean not null default true,
    grant_committed_cents  bigint not null default 0,
    created_at             timestamptz not null default now()
  )`,
  `create unique index if not exists fin_budgets_one_reserve on fin_budgets (is_reserve) where is_reserve`,
  `create table if not exists fin_guidelines (
    budget_id        bigint not null,
    category_id      bigint not null,
    guideline_cents  bigint not null default 0 check (guideline_cents >= 0),
    primary key (budget_id, category_id)
  )`,
  // claims: reimbursements and vendor invoices
  `create table if not exists fin_claims (
    id                 bigserial primary key,
    seq                integer not null unique,
    kind               text not null check (kind in ('reimbursement', 'invoice')),
    status             text not null check (status in ('pending_review', 'pending_finance', 'approved', 'rejected', 'paid')),
    claimant_id        bigint not null,
    claimant_name      text not null,
    division_id        bigint,
    budget_id          bigint not null,
    category_id        bigint not null,
    description        text not null,
    amount_cents       bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
    expense_date       date,
    vendor_name        text,
    due_date           date,
    payout_type        text not null check (payout_type in ('paynow_mobile', 'paynow_uen', 'bank')),
    payout_masked      text not null,
    payout_enc         text not null,
    rejection_reason   text,
    payment_reference  text,
    paid_on            date,
    submission_id      text not null,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (claimant_id, submission_id)
  )`,
  `create index if not exists fin_claims_status on fin_claims (status, created_at)`,
  // receipts and invoices, uploaded before the claim is sent
  `create table if not exists fin_files (
    id          bigserial primary key,
    owner_id    bigint not null,
    claim_id    bigint,
    name        text not null,
    type        text not null,
    size        integer not null,
    data        bytea not null,
    created_at  timestamptz not null default now()
  )`,
  `create index if not exists fin_files_claim on fin_files (claim_id)`,
  // a member's remembered payout details (encrypted, like claims')
  `create table if not exists fin_saved_payouts (
    member_id      bigint primary key,
    payout_type    text not null,
    payout_masked  text not null,
    payout_enc     text not null,
    updated_at     timestamptz not null default now()
  )`,
  // Normal's bank accounts and an append-only ledger (signed: money in is positive)
  `create table if not exists fin_bank_accounts (
    id          bigserial primary key,
    name        text not null unique,
    bank        text not null default 'DBS',
    last4       text not null check (last4 ~ '^[0-9]{4}$'),
    active      boolean not null default true,
    created_at  timestamptz not null default now()
  )`,
  `create table if not exists fin_bank_entries (
    id           bigserial primary key,
    account_id   bigint not null,
    kind         text not null check (kind in ('opening', 'grant', 'payout', 'adjustment', 'transfer_in', 'transfer_out')),
    amount_cents bigint not null,
    entry_date   date not null,
    note         text,
    claim_id     bigint unique,
    transfer_id  text,
    actor        text,
    created_at   timestamptz not null default now()
  )`,
  // a budget's grants received, loans from the reserve and repayments (append-only)
  `create table if not exists fin_funds (
    id             bigserial primary key,
    budget_id      bigint not null,
    kind           text not null check (kind in ('grant', 'loan', 'repayment')),
    amount_cents   bigint not null check (amount_cents > 0),
    entry_date     date not null,
    note           text,
    bank_entry_id  bigint,
    actor          text,
    created_at     timestamptz not null default now()
  )`,
  // money added to the reserve (append-only)
  `create table if not exists fin_reserve_additions (
    id            bigserial primary key,
    amount_cents  bigint not null check (amount_cents > 0),
    added_on      date not null,
    note          text not null,
    actor         text,
    created_at    timestamptz not null default now()
  )`,
  // notices the claim form shows above its declaration
  `create table if not exists fin_rules (
    id          bigserial primary key,
    title       text not null,
    body        text not null,
    applies_to  text not null default 'all' check (applies_to in ('all', 'reimbursement', 'invoice')),
    link_label  text,
    link_url    text,
    sort        integer not null default 0,
    active      boolean not null default true
  )`,

  `create table if not exists admin_login_failures (
    username  text not null,
    at        timestamptz not null default now()
  )`,
  `create index if not exists admin_login_failures_user_at on admin_login_failures (username, at)`,
  `create table if not exists settings (key text primary key, value text)`,
];

// On the very first run, copy the IPs and events from whats-on.json into the database.
async function seedWhatsOn(q) {
  const [done] = await q(`select value from settings where key = 'seeded_whats_on'`);
  if (done) return;
  const seed = require("../whats-on.json");
  for (const [i, ip] of (seed.ips || []).entries()) {
    await q(`insert into ips (name, theme, kicker, blurb, link, image, sort) values ($1, $2, $3, $4, $5, $6, $7)`,
      [ip.name, ip.theme || null, ip.kicker || null, ip.blurb || null, ip.link || null, ip.image || null, i]);
  }
  for (const e of seed.events || []) {
    await q(`insert into events (title, date, time, place, blurb, link, recap, image) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.title, e.date, e.time || null, e.place || null, e.blurb || null, e.link || null, e.recap || null, e.image || null]);
  }
  await q(`insert into settings (key, value) values ('seeded_whats_on', now()::text) on conflict (key) do nothing`);
}

// The finance app's spend categories (its migration 0011), and the reserve: added once.
const CATEGORIES = [
  ["Venue & Rental", "venue_production"], ["Production & AV", "venue_production"], ["Equipment (Capital)", "venue_production"],
  ["Materials & Consumables", "programme"], ["F&B – Participants", "programme"], ["Prizes & Gifts", "programme"],
  ["Manpower – External", "people"], ["Honoraria & Team Payments", "people"], ["F&B – Team", "people"],
  ["Marketing & Content", "marketing"], ["Merch & Wristbands", "marketing"],
  ["Transport & Logistics", "operations"], ["Software & Subscriptions", "operations"], ["Admin & Fees", "operations"], ["Miscellaneous", "operations"],
];
async function seedFinance(q) {
  const [done] = await q(`select value from settings where key = 'seeded_finance'`);
  if (done) return;
  for (const [i, [name, grp]] of CATEGORIES.entries()) {
    await q(`insert into fin_categories (name, grp, sort) values ($1, $2, $3) on conflict (name) do nothing`, [name, grp, i]);
  }
  await q(`insert into fin_budgets (name, kind, is_reserve) values ('Reserve', 'general', true) on conflict do nothing`);
  await q(`insert into settings (key, value) values ('seeded_finance', now()::text) on conflict (key) do nothing`);
}

async function ensureSchema(q) {
  for (const statement of SCHEMA) await q(statement);
  await seedWhatsOn(q);
  await seedFinance(q);
}

// Returns a query(text, params) function, or null when no database is set up.
async function db() {
  const q = connect();
  if (!q) return null;
  if (!ready) ready = ensureSchema(q).catch((e) => { ready = null; throw e; });
  await ready;
  return q;
}

module.exports = {
  db,
  // tests swap in a local Postgres
  _useQueryForTests(fn) { query = fn; ready = null; },
};

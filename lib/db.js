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

async function ensureSchema(q) {
  for (const statement of SCHEMA) await q(statement);
  await seedWhatsOn(q);
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

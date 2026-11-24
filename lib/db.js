// The database: Postgres via Vercel's Neon add-on, which sets DATABASE_URL.
// Tables are created automatically the first time they're needed.

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

async function ensureSchema(q) {
  await q(`create table if not exists applications (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    name        text not null,
    phone       text,
    telegram    text,
    dob         date,
    life_stage  text,
    school      text,
    answers     jsonb not null
  )`);
  await q(`create index if not exists applications_created_at on applications (created_at desc)`);
  await q(`create table if not exists admin_login_failures (
    username  text not null,
    at        timestamptz not null default now()
  )`);
  await q(`create index if not exists admin_login_failures_user_at on admin_login_failures (username, at)`);
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

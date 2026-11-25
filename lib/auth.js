// Admin portal sign-in, roles and setup links.
//
// Two kinds of login:
//   • Master Admins in the ADMIN_USERS environment variable (the way in before any accounts exist).
//     One entry per person, separated by commas or new lines: ashton:pbkdf2$210000$<salt>$<hash>
//     Make an entry on the /setup page. They can't be edited or removed from the portal.
//   • Accounts a Master Admin creates in the portal (the accounts table). Each gets a one-time
//     setup link, valid 7 days, where they choose their own password.
//
// Roles: master (everything, plus accounts), admin (sees and edits everything else),
// member (the members directory; edits only their own profile).
//
// A session is a signed cookie. It carries a tag of the person's password, role and status,
// so changing any of those (or disabling the account) signs them out everywhere.

const crypto = require("crypto");
const { db } = require("./db");

const COOKIE = "nn_admin";
const MAX_AGE = 60 * 60 * 12; // 12 hours
const SETUP_DAYS = 7;
const ROLES = ["master", "admin", "member"];

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* ───────────── passwords ───────────── */

const HASH_RE = /^pbkdf2\$\d+\$[\w-]+\$[\w-]+$/;

function users() {
  const out = new Map();
  for (const entry of (process.env.ADMIN_USERS || "").split(/[,\n]/)) {
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const name = entry.slice(0, i).trim().toLowerCase();
    const hash = entry.slice(i + 1).trim();
    if (name && HASH_RE.test(hash)) out.set(name, hash);
  }
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256");
  return `pbkdf2$210000$${b64url(salt)}$${b64url(hash)}`;
}

function verifyPassword(stored, password) {
  const [, iter, salt, hash] = stored.split("$");
  const want = Buffer.from(hash, "base64url");
  const got = crypto.pbkdf2Sync(String(password), Buffer.from(salt, "base64url"), Number(iter), want.length, "sha256");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// so a wrong name takes as long as a wrong password
const DUMMY = `pbkdf2$210000$${b64url(crypto.randomBytes(16))}$${b64url(crypto.randomBytes(32))}`;

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MIN_PASSWORD = 10;

/* ───────────── setup links ───────────── */

// → { token, hash, expires }. Only the hash is stored; the token goes in the link.
function newSetupToken() {
  const token = b64url(crypto.randomBytes(32));
  return { token, hash: sha256(token), expires: new Date(Date.now() + SETUP_DAYS * 864e5) };
}

function setupLink(req, token) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "admin.newnormal.sg");
  const proto = String(req.headers["x-forwarded-proto"] || (/^localhost(:|$)/.test(host) ? "http" : "https")).split(",")[0];
  const path = host === "admin.newnormal.sg" ? "/welcome" : "/admin/welcome.html";
  return `${proto}://${host}${path}#t=${token}`;
}

/* ───────────── sessions ───────────── */

function secret() {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET;
  return sha256(`nn-admin|${process.env.ADMIN_USERS || ""}|${process.env.DATABASE_URL || process.env.POSTGRES_URL || ""}`);
}

const mac = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");
const envTag = (hash) => sha256(`env|${hash}`).slice(0, 16);
const accountTag = (a) => sha256(`db|${a.id}|${a.password_hash}|${a.session_version}|${a.role}|${a.disabled}`).slice(0, 16);

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// who: { source: "env", username } or { source: "db", account }
function startSession(res, who) {
  const p = who.source === "env"
    ? { s: "env", u: who.username, v: envTag(users().get(who.username)) }
    : { s: "db", u: who.account.username, v: accountTag(who.account) };
  p.exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const body = b64url(JSON.stringify(p));
  res.setHeader("Set-Cookie", cookieHeader(`${body}.${mac(body)}`, MAX_AGE));
}

function endSession(res) {
  res.setHeader("Set-Cookie", cookieHeader("", 0));
}

function readCookie(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return "";
}

function readSession(req) {
  const raw = readCookie(req);
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const want = Buffer.from(mac(body));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p && p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

// → { username, name, role, accountId, memberId, fixed } or null
async function currentUser(req) {
  const p = readSession(req);
  if (!p) return null;
  if (p.s === "env") {
    const hash = users().get(p.u);
    if (!hash || envTag(hash) !== p.v) return null;
    // a Master Admin from ADMIN_USERS can link their login to their own member record ("This is me")
    const q = await db().catch(() => null);
    const [link] = q ? await q(`select m.id, m.name from settings s join members m on m.id = s.value::bigint where s.key = $1`, [`env_member:${p.u}`]) : [];
    return { username: p.u, name: link ? link.name : p.u, role: "master", accountId: null, memberId: link ? Number(link.id) : null, fixed: true, finance: true };
  }
  if (p.s !== "db" || users().has(p.u)) return null;
  const q = await db();
  if (!q) return null;
  const [a] = await q(`select * from accounts where username = $1`, [p.u]);
  if (!a || a.disabled || !a.password_hash || accountTag(a) !== p.v) return null;
  return {
    username: a.username, name: a.name, role: a.role, accountId: Number(a.id),
    memberId: a.member_id === null ? null : Number(a.member_id), fixed: false,
    finance: a.role === "master" || a.finance === true, // Master Admins are always on the Finance team
  };
}

/* ───────────── guarding endpoints ───────────── */

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
}

// Every admin endpoint starts here. Answers 401/403 itself and returns null when the person can't continue.
// roles: who may use this request. Anything other than GET also needs our pages' header (blocks forged cross-site requests).
async function guard(req, res, roles = ROLES) {
  noStore(res);
  if (req.method !== "GET" && req.headers["x-requested-with"] !== "normal-admin") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "signed_out" });
    return null;
  }
  if (!roles.includes(user.role)) {
    res.status(403).json({ error: "not_allowed" });
    return null;
  }
  return user;
}

function body(req) {
  let b = req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { b = null; }
  }
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}

module.exports = {
  ROLES, USERNAME_RE, MIN_PASSWORD, DUMMY, users, hashPassword, verifyPassword, sha256,
  newSetupToken, setupLink, startSession, endSession, currentUser, guard, noStore, body,
};

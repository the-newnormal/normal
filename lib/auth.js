// Admin sign-in: one personal login per person, set in the ADMIN_USERS environment variable.
//
// ADMIN_USERS holds one entry per person, separated by commas or new lines:
//   ashton:pbkdf2$210000$<salt>$<hash>, jamie:pbkdf2$210000$<salt>$<hash>
// Make an entry on the /setup page (admin.newnormal.sg/setup). The password itself is never stored.
// Removing someone's entry (or changing their password) signs them out everywhere.

const crypto = require("crypto");

const COOKIE = "nn_admin";
const MAX_AGE = 60 * 60 * 12; // 12 hours

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function users() {
  const out = new Map();
  for (const entry of (process.env.ADMIN_USERS || "").split(/[,\n]/)) {
    const i = entry.indexOf(":");
    if (i < 1) continue;
    const name = entry.slice(0, i).trim().toLowerCase();
    const hash = entry.slice(i + 1).trim();
    if (name && /^pbkdf2\$\d+\$[\w-]+\$[\w-]+$/.test(hash)) out.set(name, hash);
  }
  return out;
}

function verifyPassword(stored, password) {
  const [, iter, salt, hash] = stored.split("$");
  const want = Buffer.from(hash, "base64url");
  const got = crypto.pbkdf2Sync(String(password), Buffer.from(salt, "base64url"), Number(iter), want.length, "sha256");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// so a wrong name takes as long as a wrong password
const DUMMY = `pbkdf2$210000$${b64url(crypto.randomBytes(16))}$${b64url(crypto.randomBytes(32))}`;

function secret() {
  if (process.env.ADMIN_SESSION_SECRET) return process.env.ADMIN_SESSION_SECRET;
  return crypto.createHash("sha256")
    .update(`nn-admin|${process.env.ADMIN_USERS || ""}|${process.env.DATABASE_URL || process.env.POSTGRES_URL || ""}`)
    .digest("hex");
}

const tag = (hash) => crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 10);
const mac = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function startSession(res, name) {
  const hash = users().get(name);
  const body = b64url(JSON.stringify({ u: name, v: tag(hash), exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  res.setHeader("Set-Cookie", cookieHeader(`${body}.${mac(body)}`, MAX_AGE));
}

function endSession(res) {
  res.setHeader("Set-Cookie", cookieHeader("", 0));
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return "";
}

// → the signed-in person's name, or null
function currentUser(req) {
  const raw = readCookie(req);
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const want = Buffer.from(mac(body));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p || p.exp < Date.now() / 1000) return null;
  const hash = users().get(p.u);
  if (!hash || tag(hash) !== p.v) return null;
  return p.u;
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
}

// For admin endpoints: returns the person's name, or answers 401 and returns null.
function requireAdmin(req, res) {
  noStore(res);
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "signed_out" });
    return null;
  }
  return user;
}

module.exports = { users, verifyPassword, DUMMY, startSession, endSession, currentUser, requireAdmin, noStore };

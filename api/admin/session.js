// /api/admin/session
//   GET     → who is signed in
//   POST    → sign in with { name, password }
//   DELETE  → sign out

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");

const MAX_FAILURES = 8;          // per name, per 15 minutes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  auth.noStore(res);

  if (req.method === "GET") {
    const user = auth.currentUser(req);
    return user ? res.status(200).json({ user }) : res.status(401).json({ error: "signed_out" });
  }

  // only our own pages send this header, which blocks sign-ins forged from other sites
  if (req.headers["x-requested-with"] !== "normal-admin") return res.status(403).json({ error: "forbidden" });

  if (req.method === "DELETE") {
    auth.endSession(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const users = auth.users();
  if (!users.size) return res.status(503).json({ error: "not_configured" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const name = String((body && body.name) || "").trim().toLowerCase().slice(0, 64);
  const password = String((body && body.password) || "").slice(0, 256);
  if (!name || !password) return res.status(400).json({ error: "bad_request" });

  const q = await db().catch(() => null);
  if (q) {
    const [{ n }] = await q(
      `select count(*)::int as n from admin_login_failures where username = $1 and at > now() - interval '15 minutes'`,
      [name]
    );
    if (n >= MAX_FAILURES) return res.status(429).json({ error: "too_many_tries" });
  }

  const stored = users.get(name);
  const ok = auth.verifyPassword(stored || auth.DUMMY, password) && Boolean(stored);
  if (!ok) {
    if (q) {
      await q(`insert into admin_login_failures (username) values ($1)`, [name]);
      await q(`delete from admin_login_failures where at < now() - interval '1 day'`);
    }
    await sleep(600);
    return res.status(401).json({ error: "wrong_login" });
  }

  auth.startSession(res, name);
  return res.status(200).json({ user: name });
};

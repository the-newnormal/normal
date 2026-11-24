// /api/admin/session
//   GET     → who is signed in
//   POST    { username, password }               → sign in
//   POST    { action: "peek", token }            → whose setup link this is (for the welcome page)
//   POST    { action: "setup", token, password } → choose a password from a setup link, and sign in
//   DELETE  → sign out

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");

const MAX_FAILURES = 8; // per name, per 15 minutes
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, memberId: u.memberId, fixed: u.fixed });

async function accountForToken(q, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const [a] = await q(
    `select * from accounts where setup_token_hash = $1 and setup_expires > now() and not disabled`,
    [auth.sha256(token)]
  );
  return a || null;
}

module.exports = async function handler(req, res) {
  auth.noStore(res);

  if (req.method === "GET") {
    const user = await auth.currentUser(req).catch(() => null);
    return user ? res.status(200).json({ user: publicUser(user) }) : res.status(401).json({ error: "signed_out" });
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

  const b = auth.body(req);
  const q = await db().catch(() => null);

  /* ── setup links ── */
  if (b.action === "peek" || b.action === "setup") {
    if (!q) return res.status(503).json({ error: "not_configured" });
    const a = await accountForToken(q, b.token);
    if (!a) return res.status(404).json({ error: "link_expired" });
    if (b.action === "peek") return res.status(200).json({ name: a.name, username: a.username, hasPassword: Boolean(a.password_hash) });

    const password = String(b.password || "");
    if (password.length < auth.MIN_PASSWORD || password.length > 256) return res.status(400).json({ error: "weak_password" });
    const [updated] = await q(
      `update accounts set password_hash = $2, setup_token_hash = null, setup_expires = null,
              session_version = session_version + 1, last_login = now()
        where id = $1 returning *`,
      [a.id, auth.hashPassword(password)]
    );
    await q(`delete from admin_login_failures where username = $1`, [a.username]);
    auth.startSession(res, { source: "db", account: updated });
    return res.status(200).json({ user: { username: updated.username, name: updated.name, role: updated.role } });
  }

  /* ── signing in ── */
  const username = String(b.username || b.name || "").trim().toLowerCase().slice(0, 64);
  const password = String(b.password || "").slice(0, 256);
  if (!username || !password) return res.status(400).json({ error: "bad_request" });

  const env = auth.users();
  if (!env.size && !q) return res.status(503).json({ error: "not_configured" });

  if (q) {
    const [{ n }] = await q(
      `select count(*)::int as n from admin_login_failures where username = $1 and at > now() - interval '15 minutes'`,
      [username]
    );
    if (n >= MAX_FAILURES) return res.status(429).json({ error: "too_many_tries" });
  }

  let who = null;
  if (env.has(username)) {
    if (auth.verifyPassword(env.get(username), password)) who = { source: "env", username };
  } else {
    const [a] = q ? await q(`select * from accounts where username = $1`, [username]) : [];
    const usable = a && a.password_hash && !a.disabled;
    const ok = auth.verifyPassword(usable ? a.password_hash : auth.DUMMY, password);
    if (usable && ok) who = { source: "db", account: a };
  }

  if (!who) {
    if (q) {
      await q(`insert into admin_login_failures (username) values ($1)`, [username]);
      await q(`delete from admin_login_failures where at < now() - interval '1 day'`);
    }
    await sleep(600);
    return res.status(401).json({ error: "wrong_login" });
  }

  auth.startSession(res, who);
  if (who.source === "db") await q(`update accounts set last_login = now() where id = $1`, [who.account.id]);
  const a = who.account;
  return res.status(200).json({
    user: a
      ? { username: a.username, name: a.name, role: a.role, memberId: a.member_id === null ? null : Number(a.member_id), fixed: false }
      : { username, name: username, role: "master", memberId: null, fixed: true },
  });
};

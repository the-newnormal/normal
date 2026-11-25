// /api/admin/accounts — Master Admins only.
//   GET                                             → every login, plus member profiles that don't have one yet
//   POST   { name, username, role, member }         → new account; answers with its one-time setup link
//          member: "new" (make a profile), "none", or a member id
//   POST   { action: "link", id }                   → a fresh setup link (to reset a forgotten password)
//   PATCH  { id, role?, disabled?, finance? }       → change role, disable / re-enable, or put on the Finance team
//   DELETE ?id=                                     → remove the login (their member profile stays)

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { log } = require("../../lib/activity");

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const STATE = `case when a.disabled then 'disabled'
                    when a.password_hash is null and a.setup_expires > now() then 'invited'
                    when a.password_hash is null then 'expired'
                    else 'active' end`;

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res, ["master"]);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  if (req.method === "GET") {
    const accounts = await q(
      `select a.id, a.username, a.name, a.role, a.disabled, a.finance, a.member_id, m.name as member_name,
              a.created_by, a.created_at, a.last_login, a.setup_expires, ${STATE} as state
         from accounts a left join members m on m.id = a.member_id
        order by a.disabled, a.role, lower(a.name)`
    );
    const unlinked = await q(
      `select id, name from members where id not in (select member_id from accounts where member_id is not null) order by lower(name)`
    );
    return res.status(200).json({ accounts, fixed: [...auth.users().keys()], unlinked, me: me.username });
  }

  const b = auth.body(req);

  if (req.method === "POST" && b.action === "link") {
    const id = idOf(b.id);
    const t = auth.newSetupToken();
    const [a] = id ? await q(
      `update accounts set setup_token_hash = $2, setup_expires = $3 where id = $1 returning id, name`,
      [id, t.hash, t.expires]
    ) : [];
    if (!a) return res.status(404).json({ error: "not_found" });
    await log(q, me, "made a setup link", "account", id, a.name);
    return res.status(200).json({ link: auth.setupLink(req, t.token), expires: t.expires });
  }

  if (req.method === "POST") {
    const name = clip(b.name, 120);
    const username = clip(b.username, 32).toLowerCase();
    const role = String(b.role || "");
    if (!name || !auth.USERNAME_RE.test(username) || !auth.ROLES.includes(role)) return res.status(400).json({ error: "bad_request" });
    if (auth.users().has(username)) return res.status(409).json({ error: "username_taken" });
    const [taken] = await q(`select 1 from accounts where username = $1`, [username]);
    if (taken) return res.status(409).json({ error: "username_taken" });

    let memberId = null;
    if (b.member === "new") {
      [{ id: memberId }] = await q(`insert into members (name, joined_on) values ($1, current_date) returning id`, [name]);
    } else if (b.member !== "none" && b.member !== undefined && b.member !== null && b.member !== "") {
      memberId = idOf(b.member);
      const [m] = memberId ? await q(
        `select id from members where id = $1 and id not in (select member_id from accounts where member_id is not null)`, [memberId]
      ) : [];
      if (!m) return res.status(409).json({ error: "member_has_login" });
    }

    const t = auth.newSetupToken();
    const [a] = await q(
      `insert into accounts (username, name, role, member_id, setup_token_hash, setup_expires, created_by, finance)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, username, name, role, member_id, finance`,
      [username, name, role, memberId, t.hash, t.expires, me.username, b.finance === true]
    );
    await log(q, me, "created", "account", a.id, a.name, [{ field: "Role", from: null, to: role }, { field: "Username", from: null, to: username }]);
    return res.status(201).json({ account: a, link: auth.setupLink(req, t.token), expires: t.expires });
  }

  if (req.method === "PATCH") {
    const id = idOf(b.id);
    const [a] = id ? await q(`select id, username, name, role, disabled, finance from accounts where id = $1`, [id]) : [];
    if (!a) return res.status(404).json({ error: "not_found" });
    if (a.username === me.username) return res.status(409).json({ error: "cant_change_self" });
    if (b.role !== undefined && !auth.ROLES.includes(b.role)) return res.status(400).json({ error: "bad_request" });
    const [updated] = await q(
      `update accounts set role = coalesce($2, role), disabled = coalesce($3, disabled), finance = coalesce($4, finance) where id = $1 returning id, role, disabled, finance`,
      [id, b.role ?? null, typeof b.disabled === "boolean" ? b.disabled : null, typeof b.finance === "boolean" ? b.finance : null]
    );
    const changes = [];
    if (updated.role !== a.role) changes.push({ field: "Role", from: a.role, to: updated.role });
    if (updated.finance !== a.finance) changes.push({ field: "Finance team", from: a.finance ? "yes" : "no", to: updated.finance ? "yes" : "no" });
    if (updated.disabled !== a.disabled) changes.push({ field: "Access", from: a.disabled ? "disabled" : "active", to: updated.disabled ? "disabled" : "active" });
    if (changes.length) await log(q, me, "updated", "account", id, a.name, changes);
    return res.status(200).json({ account: updated });
  }

  if (req.method === "DELETE") {
    const id = idOf(req.query.id);
    const [a] = id ? await q(`select id, username, name from accounts where id = $1`, [id]) : [];
    if (!a) return res.status(404).json({ error: "not_found" });
    if (a.username === me.username) return res.status(409).json({ error: "cant_change_self" });
    await q(`delete from accounts where id = $1`, [id]);
    await log(q, me, "deleted", "account", id, a.name);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

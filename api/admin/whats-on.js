// /api/admin/whats-on — admins only. Edits what the public "what's on" page shows.
//   GET                                   → every IP and event, hidden ones too
//   POST   { kind: "ip"|"event", ... }    → add one
//   PATCH  { kind, id, ... }              → edit (visible: true/false hides or shows it)
//   PATCH  { kind: "ip", id, move: -1|1 } → move an IP up or down the page
//   DELETE ?kind= &id=                    → remove

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { log } = require("../../lib/activity");

const LINK_RE = /^(https?:\/\/[^\s]+|[\w./-]+\.html(#[\w-]*)?|\/[^\s]*)$/; // a full web address or a page on this site
const IMAGE_RE = /^(https?:\/\/[^\s]+|assets\/[\w./-]+)$/;
const SPEC = {
  ip: {
    table: "ips",
    fields: { name: 80, theme: 40, kicker: 120, blurb: 240, link: 300, image: 300 },
    required: ["name"],
    order: "sort, id",
  },
  event: {
    table: "events",
    fields: { title: 120, date: 10, time: 60, place: 120, blurb: 600, link: 300, recap: 300, image: 300 },
    required: ["title", "date"],
    order: "date desc, id",
  },
};

const idOf = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function clean(spec, input, creating) {
  const values = {};
  for (const [f, max] of Object.entries(spec.fields)) {
    if (!(f in input)) continue;
    const v = input[f] === null || input[f] === undefined ? "" : String(input[f]).trim().slice(0, max);
    if (v && (f === "link" || f === "recap") && !LINK_RE.test(v)) return { error: `bad_${f}` };
    if (v && f === "image" && !IMAGE_RE.test(v)) return { error: "bad_image" };
    if (v && f === "theme" && !/^[a-z-]+$/.test(v)) return { error: "bad_theme" };
    if (f === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: "bad_date" };
    values[f] = v === "" ? null : v;
  }
  if ("visible" in input) values.visible = Boolean(input.visible);
  for (const f of spec.required) {
    if ((creating || f in values) && !values[f]) return { error: `${f}_required` };
  }
  return { values };
}

module.exports = async function handler(req, res) {
  const me = await auth.guard(req, res, ["master", "admin"]);
  if (!me) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  if (req.method === "GET") {
    const ips = await q(`select * from ips order by ${SPEC.ip.order}`);
    const events = await q(`select id, title, date::text as date, time, place, blurb, link, recap, image, visible, updated_at from events order by ${SPEC.event.order}`);
    return res.status(200).json({ ips, events });
  }

  const b = req.method === "DELETE" ? req.query : auth.body(req);
  const spec = SPEC[b.kind];
  if (!spec) return res.status(400).json({ error: "bad_kind" });

  if (req.method === "POST") {
    const c = clean(spec, b, true);
    if (c.error) return res.status(400).json({ error: c.error });
    if (b.kind === "ip") {
      const [{ next }] = await q(`select coalesce(max(sort), -1) + 1 as next from ips`);
      c.values.sort = next;
    }
    const keys = Object.keys(c.values);
    const [row] = await q(
      `insert into ${spec.table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      keys.map((k) => c.values[k])
    );
    await log(q, me, "created", b.kind, row.id, c.values.name || c.values.title);
    return res.status(201).json({ id: Number(row.id) });
  }

  const id = idOf(b.id);
  if (!id) return res.status(400).json({ error: "bad_request" });

  if (req.method === "PATCH" && b.kind === "ip" && (b.move === -1 || b.move === 1)) {
    const all = await q(`select id from ips order by ${SPEC.ip.order}`);
    const i = all.findIndex((r) => Number(r.id) === id);
    if (i < 0) return res.status(404).json({ error: "not_found" });
    const j = i + b.move;
    if (j >= 0 && j < all.length) [all[i], all[j]] = [all[j], all[i]];
    for (const [n, r] of all.entries()) await q(`update ips set sort = $2 where id = $1`, [r.id, n]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PATCH") {
    const c = clean(spec, b, false);
    if (c.error) return res.status(400).json({ error: c.error });
    const keys = Object.keys(c.values);
    if (!keys.length) return res.status(400).json({ error: "nothing_to_change" });
    const [row] = await q(
      `update ${spec.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1 returning *`,
      [id, ...keys.map((k) => c.values[k])]
    );
    if (!row) return res.status(404).json({ error: "not_found" });
    await log(q, me, "updated", b.kind, id, row.name || row.title, keys.map((k) => ({ field: k, from: null, to: c.values[k] === null ? null : String(c.values[k]) })));
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const [row] = await q(`delete from ${spec.table} where id = $1 returning *`, [id]);
    if (!row) return res.status(404).json({ error: "not_found" });
    await log(q, me, "deleted", b.kind, id, row.name || row.title);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "method_not_allowed" });
};

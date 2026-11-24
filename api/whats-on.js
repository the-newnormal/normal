// /api/whats-on → the IPs and events shown on the public "what's on" page (edited in the admin portal).
// If there's no database, the page falls back to whats-on.json.

const { db } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const q = await db().catch(() => null);
  if (!q) return res.status(503).json({ error: "not_configured" });
  const ips = await q(`select name, theme, kicker, blurb, link, image from ips where visible order by sort, id`);
  const events = await q(
    `select title, date::text as date, time, place, blurb, link, recap, image from events where visible order by date desc`
  );
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
  return res.status(200).json({ ips, events });
};

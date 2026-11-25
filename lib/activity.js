// The audit trail: who did what, when. Every change in the portal writes one line here,
// and people can leave notes on any record (they show in that record's timeline).
//   kind: "member", "application", "account", "unit", "ip", "event", "session", "import", or "record:<module>"

async function log(q, user, action, kind, refId, label, changes, note) {
  try {
    await q(
      `insert into activity (actor, actor_name, action, kind, ref_id, label, changes, note)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        user ? user.username : null, user ? user.name : null, action, kind,
        refId === null || refId === undefined ? null : Number(refId),
        label ? String(label).slice(0, 200) : null,
        changes && changes.length ? JSON.stringify(changes) : null,
        note ? String(note).slice(0, 4000) : null,
      ]
    );
  } catch (e) {
    // the trail should never stop the change itself
    console.error("Could not write to the activity log", e);
  }
}

// [{ field, from, to }] for the fields that changed (values already made readable)
function diff(before, after, labels = {}, show = (k, v) => v) {
  const out = [];
  for (const k of Object.keys(after)) {
    const a = before ? before[k] : undefined;
    const b = after[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    out.push({ field: labels[k] || k, from: a === undefined || a === null || a === "" ? null : String(show(k, a)).slice(0, 300), to: b === null || b === "" ? null : String(show(k, b)).slice(0, 300) });
  }
  return out;
}

module.exports = { log, diff };

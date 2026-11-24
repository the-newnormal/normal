// Reads a Team Map export (Team Map → Export CSV) into what /api/admin/org's import takes.
// Columns used: Name, Full name, Rounds, Division, Domain, Team, Code, Role, Status, Seat note.
// One row is one seat, so someone with two seats has two rows.
(() => {
  const ROLES = ["Founder", "Chief of Staff", "Director", "Team Lead", "Member", "Fellow", "Volunteer"];
  const STATUS = {
    active: "active", in: "active", "leaning in": "leaning in", pending: "leaning in",
    "leaning no": "leaning no", out: "alumni", "left the team": "alumni", "on break": "on break", alumni: "alumni",
  };

  function csvRows(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }

  // → { units, people, summary, warnings } or { error }
  function parse(text) {
    const rows = csvRows(String(text || "").replace(/^﻿/, ""));
    if (rows.length < 2) return { error: "This doesn't look like a Team Map export: it has no rows. Export it again from the Team Map (Export CSV)." };
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => head.indexOf(name);
    if (col("name") < 0 || col("division") < 0 || col("role") < 0) {
      return { error: "This doesn't look like a Team Map export: it needs Name, Division and Role columns." };
    }
    const get = (r, name) => (col(name) < 0 ? "" : String(r[col(name)] || "").trim());

    const units = new Map(); // key → unit
    const addUnit = (kind, name, parentKey, code) => {
      const key = (parentKey ? parentKey + " › " : "") + name;
      if (!units.has(key)) units.set(key, { key, kind, name, code: code || null, parent: parentKey || null });
      else if (code && !units.get(key).code) units.get(key).code = code;
      return key;
    };
    const people = new Map(); // lower-case name → person
    const warnings = [];

    rows.slice(1).forEach((r, i) => {
      const name = get(r, "full name") || get(r, "name");
      if (!name) return;
      const k = name.toLowerCase();
      if (!people.has(k)) people.set(k, { name, round: "", status: "", note: "", seats: [] });
      const p = people.get(k);
      if (!p.round) p.round = get(r, "rounds");

      const rawStatus = get(r, "status").toLowerCase();
      const status = STATUS[rawStatus];
      if (rawStatus && !status) warnings.push(`Row ${i + 2}: status "${get(r, "status")}" isn't known, so ${name} is marked active.`);
      if (!p.status || p.status === "active") p.status = status || p.status || "active";

      const division = get(r, "division"), domain = get(r, "domain"), team = get(r, "team");
      const note = get(r, "seat note");
      if (!division) {
        if (note) p.note = p.note ? `${p.note}\n${note}` : note;
        return;
      }
      const rawRole = get(r, "role");
      const role = ROLES.find((x) => x.toLowerCase() === rawRole.toLowerCase());
      if (rawRole && !role) warnings.push(`Row ${i + 2}: role "${rawRole}" isn't known, so ${name} is seated as a Member.`);
      let unit = addUnit("division", division, null);
      if (domain) unit = addUnit("domain", domain, unit);
      if (team) unit = addUnit("team", team, unit, get(r, "code"));
      else if (domain && get(r, "code")) units.get(unit).code = units.get(unit).code || get(r, "code");
      p.seats.push({ unit, role: role || "Member", note: note || null });
    });

    // a domain's code is the shared start of its teams' codes (PB.1, PB.2 → PB)
    for (const u of units.values()) {
      if (u.kind !== "domain" || u.code) continue;
      const codes = [...units.values()].filter((t) => t.parent === u.key && t.code).map((t) => t.code);
      const prefixes = [...new Set(codes.map((c) => (c.includes(".") ? c.split(".")[0] : null)))];
      if (codes.length && prefixes.length === 1 && prefixes[0]) u.code = prefixes[0];
    }

    const order = { division: 0, domain: 1, team: 2 };
    const unitList = [...units.values()].sort((a, b) => order[a.kind] - order[b.kind]);
    const peopleList = [...people.values()].map((p) => ({ ...p, round: p.round || null, note: p.note || null }));
    const count = (kind) => unitList.filter((u) => u.kind === kind).length;
    return {
      units: unitList,
      people: peopleList,
      warnings,
      summary: {
        divisions: count("division"), domains: count("domain"), teams: count("team"),
        people: peopleList.length,
        seats: peopleList.reduce((n, p) => n + p.seats.length, 0),
        twoSeats: peopleList.filter((p) => p.seats.length > 1).length,
        leaning: peopleList.filter((p) => p.status.startsWith("leaning")).length,
        left: peopleList.filter((p) => p.status === "alumni").length,
      },
    };
  }

  window.NormalTeamMap = { parse, csvRows };
})();

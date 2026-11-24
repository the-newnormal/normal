// The join form's questions (from join-form.json) and how answers are checked.

const form = require("../join-form.json");

const MAX_TEXT = 20000;
const questions = form.steps.flatMap((s) => s.questions);
const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
const columnId = Object.fromEntries(questions.filter((q) => q.column).map((q) => [q.column, q.id]));
const rolesQuestion = questions.find((q) => q.roles);

function clean(q, raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  switch (q.type) {
    case "short":
    case "long": {
      if (typeof raw !== "string") return undefined;
      const v = raw.trim().slice(0, MAX_TEXT);
      return v || undefined;
    }
    case "date":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    case "choice":
      return q.options.includes(raw) ? raw : undefined;
    case "consent":
      return raw === true ? true : undefined;
    case "matrix": {
      if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const out = {};
      for (const [row, col] of Object.entries(raw)) {
        if (q.rows.includes(row) && q.columns.includes(col)) out[row] = col;
      }
      return Object.keys(out).length ? out : undefined;
    }
    default:
      return undefined;
  }
}

function complete(q, v) {
  if (q.type === "matrix" && v) return q.rows.every((r) => r in v);
  return v !== undefined;
}

// → { missing: [ids], answers: {id: value} } with only known, valid answers kept
function check(raw) {
  const missing = [];
  const answers = {};
  for (const q of questions) {
    const v = clean(q, raw ? raw[q.id] : undefined);
    if (q.required && !complete(q, v)) missing.push(q.id);
    if (v !== undefined) answers[q.id] = v;
  }
  return { missing, answers };
}

// a plain-text label for a question (for spreadsheets)
function plainLabel(q) {
  return q.label || "";
}

// "row: column; row: column" for grids, "yes" for consent, otherwise the value
function plainValue(q, v) {
  if (v === undefined || v === null) return "";
  if (q.type === "matrix") {
    const order = q.roles ? (r) => q.columns.indexOf(v[r]) : (r) => q.rows.indexOf(r);
    return Object.keys(v).sort((a, b) => order(a) - order(b)).map((r) => `${r} — ${v[r]}`).join("; ");
  }
  if (q.type === "consent") return v ? "yes" : "";
  return String(v);
}

module.exports = { form, questions, byId, columnId, rolesQuestion, check, plainLabel, plainValue };

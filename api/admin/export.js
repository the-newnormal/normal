// /api/admin/export → the applications as a spreadsheet (CSV), with the same filters as the list.
// Signed-in admins only.

const { db } = require("../../lib/db");
const auth = require("../../lib/auth");
const { questions, plainLabel, plainValue } = require("../../lib/form");
const { filters } = require("./applications");

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = async function handler(req, res) {
  if (!auth.requireAdmin(req, res)) return;
  const q = await db();
  if (!q) return res.status(503).json({ error: "not_configured" });

  const f = filters(req.query);
  const rows = await q(`select id, created_at, answers from applications where ${f.where} order by created_at desc`, f.params);

  const header = ["#", "submitted", ...questions.map(plainLabel)];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    const a = typeof r.answers === "string" ? JSON.parse(r.answers) : r.answers;
    const when = new Date(r.created_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" });
    lines.push([r.id, when, ...questions.map((qq) => plainValue(qq, a[qq.id]))].map(cell).join(","));
  }

  const day = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="normal-applications-${day}.csv"`);
  // the BOM makes Excel read the file as UTF-8
  return res.status(200).send("﻿" + lines.join("\r\n"));
};

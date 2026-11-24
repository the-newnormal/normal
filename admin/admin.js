// admin.newnormal.sg: sign in, list and search applications, read one in full, export.
// Everything an applicant wrote is shown with textContent, never as HTML.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const show = (id) => ["login", "list", "detail"].forEach((s) => { $("#" + s).hidden = s !== id; });
  const fail = (msg) => { $("#error").textContent = msg || ""; };

  let form = null;          // join-form.json
  let user = null;
  const fmtDate = (d) => new Date(d).toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "X-Requested-With": "normal-admin", ...(opts.headers || {}) }, credentials: "same-origin" });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/admin/session") { signedOut(); throw new Error("signed_out"); }
    return { ok: r.ok, status: r.status, data };
  }

  /* ───────────── signing in and out ───────────── */
  function signedOut() {
    user = null;
    $("#who").hidden = true;
    show("login");
    $("#login-name").focus();
  }

  function signedIn(name) {
    user = name;
    $("#who-name").textContent = name;
    $("#who").hidden = false;
    route();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    err.textContent = "";
    $("#login-go").disabled = true;
    const r = await api("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("#login-name").value, password: $("#login-password").value }),
    }).catch(() => ({ ok: false, status: 0 }));
    $("#login-go").disabled = false;
    $("#login-password").value = "";
    if (r.ok) return signedIn(r.data.user);
    err.textContent =
      r.status === 401 ? "that name and password don't match." :
      r.status === 429 ? "too many tries. wait 15 minutes and try again." :
      r.status === 503 ? "no logins are set up yet (ADMIN_USERS in Vercel)." :
      "couldn't sign in just now. try again.";
  });

  $("#sign-out").addEventListener("click", async () => {
    await api("/api/admin/session", { method: "DELETE" }).catch(() => {});
    signedOut();
  });

  /* ───────────── the list ───────────── */
  const qs = () => {
    const p = new URLSearchParams();
    if ($("#f-q").value.trim()) p.set("q", $("#f-q").value.trim());
    if ($("#f-stage").value) p.set("stage", $("#f-stage").value);
    if ($("#f-role").value) p.set("role", $("#f-role").value);
    return p.toString();
  };
  const roleName = (label) => label.split(": ")[0];

  function topRoles(roles) {
    if (!roles) return [];
    const r = typeof roles === "string" ? JSON.parse(roles) : roles;
    const cols = form.steps.flatMap((s) => s.questions).find((q) => q.roles).columns;
    return Object.entries(r).sort((a, b) => cols.indexOf(a[1]) - cols.indexOf(b[1])).map(([role, choice]) => ({ role: roleName(role), n: cols.indexOf(choice) + 1 }));
  }

  let listTimer;
  async function loadList() {
    fail("");
    const r = await api("/api/admin/applications?" + qs()).catch(() => null);
    if (!r) return;
    if (!r.ok) return fail(r.status === 503 ? "the database isn't connected yet (add Neon in Vercel → Storage)." : "couldn't load applications.");
    const { applications, total } = r.data;
    const filtered = applications.length !== total;
    $("#count").textContent = filtered ? `${applications.length} of ${total}` : String(total);
    const rows = $("#rows");
    rows.replaceChildren();
    for (const a of applications) {
      const li = el("li");
      const link = el("a", "arow");
      link.href = `#/a/${a.id}`;
      const main = el("div", "arow__main");
      main.append(el("p", "arow__name", a.name), el("p", "arow__meta", [a.telegram, a.life_stage, a.school].filter(Boolean).join(" · ")));
      const roles = el("div", "arow__roles");
      for (const t of topRoles(a.roles)) {
        const chip = el("span", "arow__role");
        chip.append(el("span", "badge", String(t.n)), t.role);
        roles.append(chip);
      }
      link.append(main, roles, el("p", "arow__date", fmtDate(a.created_at)));
      li.append(link);
      rows.append(li);
    }
    const empty = $("#empty");
    empty.hidden = applications.length > 0;
    empty.textContent = total === 0 ? "no applications yet. they'll appear here as people apply on the join page." : "nothing matches those filters.";
  }
  ["#f-q", "#f-stage", "#f-role"].forEach((s) => $(s).addEventListener("input", () => {
    clearTimeout(listTimer);
    listTimer = setTimeout(loadList, 250);
  }));
  $("#export").addEventListener("click", () => { window.location.href = "/api/admin/export?" + qs(); });

  /* ───────────── one application ───────────── */
  function answerNode(q, v) {
    if (v === undefined || v === null || v === "") return el("p", "a__none", "—");
    if (q.type === "matrix") {
      const order = q.roles ? (r) => q.columns.indexOf(v[r]) : (r) => q.rows.indexOf(r);
      const ul = el("ul", "a__grid");
      Object.keys(v).sort((a, b) => order(a) - order(b)).forEach((row) => {
        const li = el("li");
        li.append(el("span", "a__grid-row", q.roles ? roleName(row) : row), el("span", "a__grid-col", v[row]));
        ul.append(li);
      });
      return ul;
    }
    if (q.type === "consent") return el("p", "a__text", v ? "✓ agreed to the notice" : "—");
    if (q.type === "date") return el("p", "a__text", new Date(v + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }));
    return el("p", "a__text", String(v));
  }

  async function loadDetail(id) {
    fail("");
    const r = await api(`/api/admin/applications?id=${encodeURIComponent(id)}`).catch(() => null);
    if (!r) return;
    if (!r.ok) return fail(r.status === 404 ? "that application doesn't exist." : "couldn't load that application.");
    const a = r.data.application;
    const ans = typeof a.answers === "string" ? JSON.parse(a.answers) : a.answers;
    const body = $("#detail-body");
    body.replaceChildren();

    const head = el("header", "adetail__head");
    head.append(el("p", "kicker", `#${a.id} · applied ${fmtDate(a.created_at)}`), el("h1", "admin__h1", a.name));
    const facts = el("ul", "adetail__facts");
    const fact = (label, text, href) => {
      if (!text) return;
      const li = el("li");
      li.append(el("span", "adetail__fact-label", label));
      if (href) {
        const link = el("a", "", text);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener";
        li.append(link);
      } else {
        li.append(el("span", "", text));
      }
      facts.append(li);
    };
    const digits = (a.phone || "").replace(/[^\d]/g, "");
    const handle = (a.telegram || "").replace(/^@/, "").trim();
    fact("WhatsApp", a.phone, digits ? `https://wa.me/${digits.length === 8 ? "65" + digits : digits}` : null);
    fact("Telegram", a.telegram, /^[\w]{3,}$/.test(handle) ? `https://t.me/${handle}` : null);
    if (a.dob) {
      const dob = new Date(String(a.dob).slice(0, 10) + "T00:00:00");
      const age = Math.floor((Date.now() - dob) / (365.25 * 24 * 3600 * 1000));
      fact("born", `${dob.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} (${age})`);
    }
    fact("life stage", a.life_stage);
    fact("school / org", a.school);
    head.append(facts);
    body.append(head);

    // these are already shown at the top
    const skip = new Set(["name", "phone", "telegram", "dob", "life_stage", "school"]);
    form.steps.forEach((step) => {
      const qsInStep = step.questions.filter((q) => !(q.column && skip.has(q.column)));
      if (!qsInStep.length) return;
      const sec = el("section", "adetail__section");
      sec.append(el("h2", "adetail__h2", step.heading));
      for (const q of qsInStep) {
        const item = el("div", "a__item");
        item.append(el("p", "a__q", q.label), answerNode(q, ans[q.id]));
        sec.append(item);
      }
      body.append(sec);
    });
  }

  /* ───────────── which view ───────────── */
  function route() {
    if (!user) return;
    const m = location.hash.match(/^#\/a\/(\d+)$/);
    if (m) {
      show("detail");
      window.scrollTo(0, 0);
      loadDetail(m[1]);
    } else {
      show("list");
      loadList();
    }
  }
  addEventListener("hashchange", route);

  /* ───────────── start ───────────── */
  fetch("/join-form.json").then((r) => r.json()).then(async (json) => {
    form = json;
    const qsAll = form.steps.flatMap((s) => s.questions);
    for (const o of qsAll.find((q) => q.column === "life_stage").options) $("#f-stage").append(new Option(o, o));
    for (const row of qsAll.find((q) => q.roles).rows) $("#f-role").append(new Option(roleName(row), row));
    const r = await api("/api/admin/session").catch(() => ({ ok: false }));
    if (r.ok) signedIn(r.data.user);
    else signedOut();
  }).catch(() => fail("couldn't start. refresh the page."));
})();

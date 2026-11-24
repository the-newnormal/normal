// admin.newnormal.sg — the Normal admin portal.
//   members       everyone in Normal (members see names, titles, teams and Telegram; edit their own details)
//   applications  join-page applications: read, set a status, accept into members        (admins)
//   what's on     the IPs and events on the public what's on page                         (admins)
//   accounts      who can sign in, and as what; one-time setup links                      (Master Admins)
// The server checks every permission; this page only hides what you can't use.
// Everything people typed is shown with textContent, never as HTML.
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };
  const show = (id) => $$("[data-view]").forEach((v) => { v.hidden = v.id !== id; });
  const fail = (msg) => { $("#error").textContent = msg || ""; };
  let toastTimer;
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2600);
  };

  let me = null;
  let form = null; // join-form.json, loaded the first time applications are opened
  const isAdmin = () => me && (me.role === "master" || me.role === "admin");
  const ROLE_NAMES = { master: "Master Admin", admin: "Admin", member: "Member" };

  const day = (d) => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "";
  const when = (d) => d ? new Date(d).toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }) : "";
  const handleOf = (t) => (t || "").replace(/^@/, "").trim();
  const waOf = (p) => {
    const d = (p || "").replace(/[^\d]/g, "");
    return d ? `https://wa.me/${d.length === 8 ? "65" + d : d}` : null;
  };
  const ERRORS = {
    username_taken: "that username is taken.",
    member_has_login: "that profile already has a login.",
    cant_change_self: "you can't change your own account here.",
    name_required: "a name is needed.",
    title_required: "a title is needed.",
    bad_date: "pick a date.",
    bad_email: "that email doesn't look right.",
    bad_link: "links must start with https:// (or be a page here, like backyard.html).",
    bad_recap: "links must start with https:// (or be a page here, like backyard.html).",
    bad_image: "images must be a full https:// address or a file in assets/.",
    not_allowed: "you don't have access to that.",
    not_configured: "the database isn't connected yet (add Neon in Vercel → Storage).",
  };
  const errText = (r, fallback) => ERRORS[r && r.data && r.data.error] || fallback || "couldn't save that. try again.";

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: { "X-Requested-With": "normal-admin" } };
    if (opts.json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.json);
    }
    const r = await fetch(path, init);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/admin/session") { signedOut(); throw new Error("signed_out"); }
    return { ok: r.ok, status: r.status, data };
  }
  const get = (path) => api(path).catch(() => null);

  /* ───────────── signing in and out ───────────── */
  function signedOut() {
    me = null;
    $("#who").hidden = true;
    $("#tabs").hidden = true;
    show("login");
    $("#login-name").focus();
  }

  function signedIn(user) {
    me = user;
    $("#who-name").textContent = user.name;
    $("#who-name").href = user.memberId ? `#/m/${user.memberId}` : "#/";
    $("#who-role").textContent = ROLE_NAMES[user.role] || user.role;
    $("#who").hidden = false;
    $$("#tabs [data-roles]").forEach((a) => { a.hidden = !a.dataset.roles.split(" ").includes(user.role); });
    $("#tabs").hidden = false;
    listKey = null;
    route();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    err.textContent = "";
    $("#login-go").disabled = true;
    const r = await api("/api/admin/session", {
      method: "POST",
      json: { username: $("#login-name").value, password: $("#login-password").value },
    }).catch(() => ({ ok: false, status: 0 }));
    $("#login-go").disabled = false;
    $("#login-password").value = "";
    if (r.ok) return signedIn(r.data.user);
    err.textContent =
      r.status === 401 ? "that username and password don't match." :
      r.status === 429 ? "too many tries. wait 15 minutes and try again." :
      r.status === 503 ? "no logins are set up yet (ADMIN_USERS in Vercel)." :
      "couldn't sign in just now. try again.";
  });

  $("#sign-out").addEventListener("click", async () => {
    await api("/api/admin/session", { method: "DELETE" }).catch(() => {});
    signedOut();
  });

  /* ───────────── building blocks ───────────── */
  const chip = (text, kind) => el("span", `achip${kind ? " achip--" + kind.replace(/\s+/g, "-") : ""}`, text);

  function row(href, name, meta, side) {
    const li = el("li");
    const a = el(href ? "a" : "div", "arow");
    if (href) a.href = href;
    const main = el("div", "arow__main");
    main.append(el("p", "arow__name", name), el("p", "arow__meta", meta));
    const right = el("div", "arow__side");
    right.append(...side.filter(Boolean));
    a.append(main, right);
    li.append(a);
    return li;
  }

  function facts(items) {
    const ul = el("ul", "adetail__facts");
    for (const [label, text, href] of items) {
      if (!text) continue;
      const li = el("li");
      li.append(el("span", "adetail__fact-label", label));
      if (href) {
        const a = el("a", "", text);
        a.href = href;
        if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
        li.append(a);
      } else {
        li.append(el("span", "", text));
      }
      ul.append(li);
    }
    return ul;
  }

  function select(label, options, value) {
    const s = el("select");
    s.setAttribute("aria-label", label);
    for (const o of options) s.append(new Option(Array.isArray(o) ? o[1] : o, Array.isArray(o) ? o[0] : o));
    if (value !== undefined) s.value = value;
    return s;
  }

  // defs: [{ key, label, type, options, hint, required, wide }]; values: current values
  function buildForm(defs, values, { submit, onSubmit, extra }) {
    const f = el("form", "admin__form");
    f.noValidate = true;
    const inputs = {};
    for (const d of defs) {
      const wrap = el("div", `q${d.wide ? " q--wide" : ""}`);
      const id = `fld-${d.key}`;
      let input;
      if (d.type === "checkbox") {
        const lab = el("label", "consent");
        input = el("input");
        input.type = "checkbox";
        input.checked = values ? values[d.key] !== false : true;
        lab.append(input, el("span", "", d.label));
        wrap.append(lab);
      } else {
        const lab = el("label", "q__label", d.label);
        lab.htmlFor = id;
        if (!d.required && d.type !== "select") lab.append(el("span", "q__opt", "optional"));
        wrap.append(lab);
        if (d.hint) wrap.append(el("p", "q__hint", d.hint));
        if (d.type === "textarea") input = el("textarea");
        else if (d.type === "select") input = select(d.label, d.options);
        else {
          input = el("input");
          input.type = d.type || "text";
          if (d.type === "text" || !d.type) input.autocomplete = "off";
        }
        if (d.list) input.setAttribute("list", d.list);
        const v = values ? values[d.key] : undefined;
        if (v !== undefined && v !== null) input.value = d.type === "date" ? String(v).slice(0, 10) : v;
        wrap.append(input);
      }
      input.id = id;
      input.name = d.key;
      inputs[d.key] = input;
      f.append(wrap);
    }
    const status = el("p", "join__status is-error");
    status.setAttribute("role", "alert");
    const bar = el("div", "admin__formbar");
    const go = el("button", "btn", submit);
    go.type = "submit";
    bar.append(go, ...(extra || []));
    f.append(status, bar);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      const vals = {};
      for (const [k, input] of Object.entries(inputs)) vals[k] = input.type === "checkbox" ? input.checked : input.value.trim();
      const missing = defs.find((d) => d.required && !vals[d.key]);
      if (missing) {
        status.textContent = `${missing.label} is needed.`;
        inputs[missing.key].focus();
        return;
      }
      go.disabled = true;
      try { await onSubmit(vals, status); } finally { go.disabled = false; }
    });
    return { form: f, inputs };
  }

  function confirmButton(text, question, onYes) {
    const b = el("button", "btn btn--ghost btn--sm btn--danger", text);
    b.type = "button";
    b.addEventListener("click", () => { if (confirm(question)) onYes(); });
    return b;
  }

  function detail(backHref, backText) {
    show("detail");
    window.scrollTo(0, 0);
    $("#back").href = backHref;
    $("#back").textContent = `← ${backText}`;
    const body = $("#detail-body");
    body.replaceChildren();
    return body;
  }

  // Lists keep their filters while you open an item and come back.
  let listKey = null;
  let loadRows = () => {};
  function openList(key, setup) {
    show("list");
    if (listKey !== key) {
      listKey = key;
      $("#filters").replaceChildren();
      $("#list-actions").replaceChildren();
      $("#rows").replaceChildren();
      $("#count").textContent = "";
      $("#empty").hidden = true;
      setup();
    }
    loadRows();
  }
  let filterTimer;
  function filterInputs(nodes) {
    $("#filters").replaceChildren(...nodes);
    nodes.forEach((n) => n.addEventListener("input", () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => loadRows(), 250);
    }));
  }
  const searchBox = (placeholder) => {
    const i = el("input");
    i.type = "search";
    i.placeholder = placeholder;
    i.setAttribute("aria-label", "Search");
    return i;
  };
  function fillRows(items, total, emptyAll, emptyFiltered) {
    $("#count").textContent = items.length !== total ? `${items.length} of ${total}` : String(total);
    $("#rows").replaceChildren(...items);
    $("#empty").hidden = items.length > 0;
    $("#empty").textContent = total === 0 ? emptyAll : emptyFiltered;
  }
  const params = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

  /* ───────────── members ───────────── */
  const MEMBER_FIELDS = [
    { key: "name", label: "full name", required: true },
    { key: "title", label: "title", hint: "e.g. head of events" },
    { key: "team", label: "team", list: "team-list" },
    { key: "telegram", label: "telegram" },
    { key: "phone", label: "phone (WhatsApp)", type: "tel" },
    { key: "email", label: "email", type: "email" },
    { key: "dob", label: "birthday", type: "date" },
    { key: "school", label: "school / organisation" },
    { key: "joined_on", label: "joined Normal", type: "date" },
    { key: "status", label: "status", type: "select", options: ["active", "on break", "alumni"] },
    { key: "notes", label: "notes", hint: "only admins see these.", type: "textarea", wide: true },
  ];
  let teams = [];
  function teamList() {
    let dl = $("#team-list");
    if (!dl) { dl = el("datalist"); dl.id = "team-list"; document.body.append(dl); }
    dl.replaceChildren(...teams.map((t) => new Option(t)));
  }

  function membersList() {
    openList("members", () => {
      $("#list-title").textContent = "members";
      const q = searchBox(isAdmin() ? "search names, teams, contacts…" : "search names, titles, teams…");
      const team = select("Team", [["", "every team"]]);
      const status = select("Status", [["", "everyone"], "active", "on break", "alumni"]);
      filterInputs([q, team, status]);
      if (isAdmin()) {
        const add = el("a", "btn btn--sm", "add someone");
        add.href = "#/m/new";
        const exp = el("button", "btn btn--ghost btn--sm", "export spreadsheet");
        exp.type = "button";
        exp.addEventListener("click", () => { location.href = "/api/admin/members?" + params({ format: "csv", q: q.value.trim(), team: team.value, status: status.value }); });
        $("#list-actions").append(exp, add);
      }
      loadRows = async () => {
        fail("");
        const r = await get("/api/admin/members?" + params({ q: q.value.trim(), team: team.value, status: status.value }));
        if (!r) return;
        if (!r.ok) return fail(errText(r, "couldn't load members."));
        teams = r.data.teams;
        if (team.options.length !== teams.length + 1) {
          const keep = team.value;
          team.replaceChildren(new Option("every team", ""), ...teams.map((t) => new Option(t)));
          team.value = keep;
        }
        fillRows(r.data.members.map((m) => row(`#/m/${m.id}`, m.name, [m.title, m.team].filter(Boolean).join(" · ") || "—", [
          m.telegram && el("span", "arow__date", "@" + handleOf(m.telegram)),
          m.status !== "active" && chip(m.status, m.status),
          m.login_role && chip(ROLE_NAMES[m.login_role], m.login_role),
          Number(m.id) === me.memberId && chip("you", "you"),
        ])), r.data.total, isAdmin() ? "no one here yet. add people, or accept them from applications." : "no one here yet.", "no one matches that.");
      };
    });
  }

  async function memberProfile(id) {
    fail("");
    const body = detail("#/members", "members");
    if (id === "new") {
      body.append(el("h1", "admin__h1", "add someone"));
      teamList();
      const { form: f } = buildForm(MEMBER_FIELDS, { status: "active", joined_on: new Date().toISOString().slice(0, 10) }, {
        submit: "add to members",
        onSubmit: async (vals, status) => {
          const r = await api("/api/admin/members", { method: "POST", json: vals }).catch(() => null);
          if (!r || !r.ok) { status.textContent = errText(r); return; }
          toast("added.");
          location.hash = `#/m/${r.data.id}`;
        },
      });
      body.append(f);
      return;
    }

    const r = await get(`/api/admin/members?id=${encodeURIComponent(id)}`);
    if (!r) return;
    if (!r.ok) return fail(r.status === 404 ? "that person isn't in the directory." : errText(r, "couldn't load that profile."));
    const { member: m, canEdit } = r.data;
    const mine = Number(m.id) === me.memberId;

    const head = el("header", "adetail__head");
    head.append(el("p", "kicker", [m.title, m.team].filter(Boolean).join(" · ") || "member"), el("h1", "admin__h1", m.name));
    const tg = handleOf(m.telegram);
    head.append(facts([
      ["telegram", m.telegram && "@" + tg, /^\w{3,}$/.test(tg) ? `https://t.me/${tg}` : null],
      ["WhatsApp", m.phone, waOf(m.phone)],
      ["email", m.email, m.email ? `mailto:${m.email}` : null],
      ["born", day(m.dob)],
      ["school / org", m.school],
      ["joined", day(m.joined_on)],
      ["status", m.status],
      ["login", m.login && `${m.login} (${ROLE_NAMES[m.login_role]})`],
    ]));
    if (m.notes) head.append(el("p", "adetail__notes", m.notes));
    body.append(head);

    if (m.application_id && isAdmin()) {
      const p = el("p", "admin__fine");
      const a = el("a", "", "read their application →");
      a.href = `#/a/${m.application_id}`;
      p.append(a);
      body.append(p);
    }

    if (canEdit.length) {
      const sec = el("section", "adetail__section");
      sec.append(el("h2", "adetail__h2", mine && !isAdmin() ? "update your details" : "edit"));
      if (mine && !isAdmin()) sec.append(el("p", "q__hint", "other members see your name, title, team and Telegram. only admins see the rest."));
      teamList();
      const extra = [];
      if (isAdmin() && !m.login && me.role === "master") {
        const login = el("a", "btn btn--ghost btn--sm", "make them a login");
        login.href = `#/accounts/new/${m.id}`;
        extra.push(login);
      }
      if (isAdmin()) {
        extra.push(confirmButton("remove from directory", `remove ${m.name} from the members directory? their login (if any) stays, but loses its profile.`, async () => {
          const d = await api(`/api/admin/members?id=${m.id}`, { method: "DELETE" }).catch(() => null);
          if (d && d.ok) { toast("removed."); location.hash = "#/members"; } else fail(errText(d));
        }));
      }
      const { form: f } = buildForm(MEMBER_FIELDS.filter((d) => canEdit.includes(d.key)), m, {
        submit: "save",
        extra,
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/members", { method: "PATCH", json: { id: m.id, ...vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          toast("saved.");
          memberProfile(id);
        },
      });
      sec.append(f);
      body.append(sec);
    }
  }

  /* ───────────── applications ───────────── */
  const roleName = (label) => label.split(": ")[0];
  const loadForm = async () => {
    if (!form) form = await fetch("/join-form.json").then((r) => r.json());
    return form;
  };
  const formQs = () => form.steps.flatMap((s) => s.questions);

  function topRoles(roles) {
    if (!roles) return [];
    const r = typeof roles === "string" ? JSON.parse(roles) : roles;
    const cols = formQs().find((q) => q.roles).columns;
    return Object.entries(r).sort((a, b) => cols.indexOf(a[1]) - cols.indexOf(b[1])).map(([role, choice]) => ({ role: roleName(role), n: cols.indexOf(choice) + 1 }));
  }

  async function applicationsList() {
    try { await loadForm(); } catch { return fail("couldn't load the form questions. refresh the page."); }
    openList("applications", () => {
      $("#list-title").textContent = "applications";
      const q = searchBox("search names, handles, answers…");
      const stage = select("Life stage", [["", "every life stage"], ...formQs().find((x) => x.column === "life_stage").options]);
      const role = select("Role", [["", "every role"], ...formQs().find((x) => x.roles).rows.map((r) => [r, roleName(r)])]);
      const status = select("Status", [["", "any status"], "new", "interviewing", "accepted", "declined"]);
      q.id = "f-q"; stage.id = "f-stage"; role.id = "f-role"; status.id = "f-status";
      filterInputs([q, stage, role, status]);
      const vals = () => ({ q: q.value.trim(), stage: stage.value, role: role.value, status: status.value });
      const exp = el("button", "btn btn--ghost btn--sm", "export spreadsheet");
      exp.type = "button";
      exp.id = "export";
      exp.addEventListener("click", () => { location.href = "/api/admin/export?" + params(vals()); });
      $("#list-actions").append(exp);
      loadRows = async () => {
        fail("");
        const r = await get("/api/admin/applications?" + params(vals()));
        if (!r) return;
        if (!r.ok) return fail(errText(r, "couldn't load applications."));
        fillRows(r.data.applications.map((a) => {
          const roles = el("span", "arow__roles");
          for (const t of topRoles(a.roles)) {
            const c = el("span", "arow__role");
            c.append(el("span", "badge", String(t.n)), t.role);
            roles.append(c);
          }
          return row(`#/a/${a.id}`, a.name, [a.telegram, a.life_stage, a.school].filter(Boolean).join(" · "), [
            roles, chip(a.status, a.status), el("span", "arow__date", when(a.created_at)),
          ]);
        }), r.data.total, "no applications yet. they'll appear here as people apply on the join page.", "nothing matches those filters.");
      };
    });
  }

  function answerNode(q, v) {
    if (v === undefined || v === null || v === "") return el("p", "a__none", "—");
    if (q.type === "matrix") {
      const order = q.roles ? (r) => q.columns.indexOf(v[r]) : (r) => q.rows.indexOf(r);
      const ul = el("ul", "a__grid");
      Object.keys(v).sort((a, b) => order(a) - order(b)).forEach((r) => {
        const li = el("li");
        li.append(el("span", "a__grid-row", q.roles ? roleName(r) : r), el("span", "a__grid-col", v[r]));
        ul.append(li);
      });
      return ul;
    }
    if (q.type === "consent") return el("p", "a__text", v ? "✓ agreed to the notice" : "—");
    if (q.type === "date") return el("p", "a__text", new Date(v + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }));
    return el("p", "a__text", String(v));
  }

  async function applicationDetail(id) {
    fail("");
    try { await loadForm(); } catch { return fail("couldn't load the form questions. refresh the page."); }
    const r = await get(`/api/admin/applications?id=${encodeURIComponent(id)}`);
    if (!r) return;
    const body = detail("#/applications", "applications");
    if (!r.ok) return fail(r.status === 404 ? "that application doesn't exist." : errText(r, "couldn't load that application."));
    const a = r.data.application;
    const ans = typeof a.answers === "string" ? JSON.parse(a.answers) : a.answers;

    const head = el("header", "adetail__head");
    head.append(el("p", "kicker", `#${a.id} · applied ${when(a.created_at)}`), el("h1", "admin__h1", a.name));
    const handle = handleOf(a.telegram);
    let born = "";
    if (a.dob) {
      const dob = new Date(String(a.dob).slice(0, 10) + "T00:00:00");
      born = `${day(a.dob)} (${Math.floor((Date.now() - dob) / (365.25 * 864e5))})`;
    }
    head.append(facts([
      ["WhatsApp", a.phone, waOf(a.phone)],
      ["Telegram", a.telegram, /^\w{3,}$/.test(handle) ? `https://t.me/${handle}` : null],
      ["born", born],
      ["life stage", a.life_stage],
      ["school / org", a.school],
    ]));

    // status, and accepting into members
    const bar = el("div", "adetail__bar");
    const status = select("Status", r.data.statuses, a.status);
    status.id = "app-status";
    status.addEventListener("change", async () => {
      const s = await api("/api/admin/applications", { method: "PATCH", json: { id: a.id, status: status.value } }).catch(() => null);
      if (s && s.ok) toast(`marked ${status.value}.`); else fail(errText(s));
    });
    const lab = el("label", "adetail__bar-label", "status");
    lab.htmlFor = "app-status";
    bar.append(lab, status);
    if (a.member_id) {
      const link = el("a", "btn btn--ghost btn--sm", "open their member profile →");
      link.href = `#/m/${a.member_id}`;
      bar.append(link);
    } else {
      const accept = el("button", "btn btn--sm", "accept, and add to members");
      accept.type = "button";
      accept.id = "accept";
      accept.addEventListener("click", async () => {
        accept.disabled = true;
        const s = await api("/api/admin/applications", { method: "POST", json: { action: "accept", id: a.id } }).catch(() => null);
        accept.disabled = false;
        if (!s || !s.ok) return fail(errText(s));
        toast(`${a.name} is now in members.`);
        location.hash = `#/m/${s.data.memberId}`;
      });
      bar.append(accept);
    }
    head.append(bar);
    body.append(head);

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

  /* ───────────── what's on ───────────── */
  const IP_FIELDS = [
    { key: "name", label: "name", required: true },
    { key: "theme", label: "card style", type: "select", options: [["", "plain Normal card"], ["backyard", "Backyard (backyard.sg colours)"], ["youthday", "Youth Day (youthday.sg colours)"]] },
    { key: "kicker", label: "small line above the name", hint: "e.g. we invite you to our" },
    { key: "blurb", label: "line below the name", hint: "a year at the end (… 2027) gets its own colour on themed cards." },
    { key: "link", label: "link", hint: "its own site, e.g. https://youthday.sg. leave empty for \"page coming soon\"." },
    { key: "image", label: "image", hint: "a full https:// address, or a file in assets/ips/." },
    { key: "visible", label: "show on the what's on page", type: "checkbox" },
  ];
  const EVENT_FIELDS = [
    { key: "title", label: "title", required: true },
    { key: "date", label: "date", type: "date", required: true },
    { key: "time", label: "time", hint: "e.g. 7–10pm" },
    { key: "place", label: "place" },
    { key: "blurb", label: "a line or two about it", type: "textarea", wide: true },
    { key: "link", label: "sign-up link", hint: "shown while it's upcoming." },
    { key: "recap", label: "recap link", hint: "shown once it's past: photos, a post, a video." },
    { key: "image", label: "photo", hint: "a full https:// address, or a file in assets/events/." },
    { key: "visible", label: "show on the what's on page", type: "checkbox" },
  ];

  async function whatsOn() {
    fail("");
    show("whats-on");
    const r = await get("/api/admin/whats-on");
    if (!r) return;
    if (!r.ok) return fail(errText(r, "couldn't load what's on."));
    const { ips, events } = r.data;

    const move = async (id, by) => {
      const s = await api("/api/admin/whats-on", { method: "PATCH", json: { kind: "ip", id, move: by } }).catch(() => null);
      if (s && s.ok) whatsOn(); else fail(errText(s));
    };
    $("#ip-rows").replaceChildren(...ips.map((ip, i) => {
      const li = row(null, ip.name, [ip.kicker, ip.blurb].filter(Boolean).join(" · ") || "—", [
        !ip.visible && chip("hidden", "hidden"),
        ip.theme && chip(ip.theme, "theme"),
      ]);
      const card = $(".arow", li);
      card.classList.add("arow--static");
      const ctl = el("span", "arow__ctl");
      const up = el("button", "arow__btn", "↑");
      up.type = "button"; up.disabled = i === 0; up.setAttribute("aria-label", `move ${ip.name} up`);
      up.addEventListener("click", () => move(ip.id, -1));
      const down = el("button", "arow__btn", "↓");
      down.type = "button"; down.disabled = i === ips.length - 1; down.setAttribute("aria-label", `move ${ip.name} down`);
      down.addEventListener("click", () => move(ip.id, 1));
      const edit = el("a", "link", "edit");
      edit.href = `#/w/ip/${ip.id}`;
      ctl.append(up, down, edit);
      $(".arow__side", li).append(ctl);
      return li;
    }));
    if (!ips.length) $("#ip-rows").append(el("li", "admin__empty", "no IPs yet. the section stays hidden on the page until there's one."));

    const today = new Date().toISOString().slice(0, 10);
    $("#event-rows").replaceChildren(...events.map((e) => row(`#/w/event/${e.id}`, e.title, [day(e.date), e.time, e.place].filter(Boolean).join(" · "), [
      chip(e.date >= today ? "coming up" : "so far", e.date >= today ? "new" : "past"),
      !e.visible && chip("hidden", "hidden"),
    ])));
    if (!events.length) $("#event-rows").append(el("li", "admin__empty", "no events yet. add one and it shows under \"coming up\", then moves to \"so far\" once the day passes."));
  }

  async function whatsOnForm(kind, id) {
    fail("");
    const isNew = id === "new";
    let item = isNew ? { visible: true } : null;
    if (!isNew) {
      const r = await get("/api/admin/whats-on");
      if (!r) return;
      if (!r.ok) return fail(errText(r));
      item = (kind === "ip" ? r.data.ips : r.data.events).find((x) => String(x.id) === id);
    }
    const body = detail("#/whats-on", "what's on");
    if (!item) return fail("that isn't there any more.");
    const noun = kind === "ip" ? "IP" : "event";
    body.append(el("h1", "admin__h1", isNew ? `add an ${noun}` : item.name || item.title));
    const extra = isNew ? [] : [confirmButton(`delete this ${noun}`, `delete "${item.name || item.title}" from the what's on page?`, async () => {
      const d = await api(`/api/admin/whats-on?kind=${kind}&id=${item.id}`, { method: "DELETE" }).catch(() => null);
      if (d && d.ok) { toast("deleted."); location.hash = "#/whats-on"; } else fail(errText(d));
    })];
    const { form: f } = buildForm(kind === "ip" ? IP_FIELDS : EVENT_FIELDS, item, {
      submit: isNew ? `add ${noun}` : "save",
      extra,
      onSubmit: async (vals, status) => {
        const s = await api("/api/admin/whats-on", { method: isNew ? "POST" : "PATCH", json: { kind, ...(isNew ? {} : { id: item.id }), ...vals } }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        toast(isNew ? "added. it's on the page within a minute." : "saved. the page updates within a minute.");
        location.hash = "#/whats-on";
      },
    });
    body.append(f);
  }

  /* ───────────── accounts (Master Admins) ───────────── */
  const STATE_NAMES = { active: "active", invited: "link sent", expired: "link expired", disabled: "disabled" };

  function accountsList() {
    openList("accounts", () => {
      $("#list-title").textContent = "accounts";
      $("#filters").replaceChildren();
      const add = el("a", "btn btn--sm", "create an account");
      add.href = "#/accounts/new";
      add.id = "new-account";
      $("#list-actions").append(add);
      loadRows = async () => {
        fail("");
        const r = await get("/api/admin/accounts");
        if (!r) return;
        if (!r.ok) return fail(errText(r, "couldn't load accounts."));
        const fixed = r.data.fixed.map((u) => row(null, u, "set in Vercel (ADMIN_USERS) · can't be changed here", [
          chip("Master Admin", "master"), u === me.username && chip("you", "you"),
        ]));
        const rows = r.data.accounts.map((a) => row(`#/accounts/${a.id}`, a.name, [`@${a.username}`, a.member_name && `profile: ${a.member_name}`, a.last_login ? `last in ${when(a.last_login)}` : "never signed in"].filter(Boolean).join(" · "), [
          chip(ROLE_NAMES[a.role], a.role),
          a.state !== "active" && chip(STATE_NAMES[a.state], a.state),
          a.username === me.username && chip("you", "you"),
        ]));
        fillRows([...fixed, ...rows], fixed.length + r.data.accounts.length, "no accounts yet.", "");
      };
    });
  }

  function linkPanel(name, link, expires) {
    const box = el("div", "admin__linkbox");
    box.append(el("h2", "adetail__h2", `send this to ${name}`));
    box.append(el("p", "q__hint", `it works once, until ${when(expires)}. they'll choose their own password. don't post it in a group chat.`));
    const input = el("input", "admin__line");
    input.type = "text";
    input.readOnly = true;
    input.value = link;
    input.id = "setup-link";
    input.addEventListener("focus", () => input.select());
    const msg = `hi ${name.split(" ")[0]}! here's your login for the Normal admin portal. open it to set your password (works once, for 7 days): ${link}`;
    const copy = el("button", "btn btn--sm", "copy link");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); toast("copied."); } catch { input.select(); }
    });
    const wa = el("a", "btn btn--ghost btn--sm", "send on WhatsApp");
    wa.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    wa.target = "_blank"; wa.rel = "noopener noreferrer";
    const tg = el("a", "btn btn--ghost btn--sm", "send on Telegram");
    tg.href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`hi ${name.split(" ")[0]}! here's your login for the Normal admin portal. open it to set your password (works once, for 7 days).`)}`;
    tg.target = "_blank"; tg.rel = "noopener noreferrer";
    const btns = el("div", "admin__formbar");
    btns.append(copy, wa, tg);
    box.append(input, btns);
    return box;
  }

  const ROLE_OPTIONS = [
    ["member", "Member: sees the members directory, edits only their own details"],
    ["admin", "Admin: sees and edits members, applications and what's on"],
    ["master", "Master Admin: everything, plus creating and managing accounts"],
  ];
  const usernameFrom = (name) => name.toLowerCase().normalize("NFKD").replace(/[^\w\s.-]/g, "").trim().split(/\s+/).join(".").replace(/[^a-z0-9._-]/g, "").slice(0, 32);

  async function accountForm(forMember) {
    fail("");
    const r = await get("/api/admin/accounts");
    if (!r) return;
    const body = detail("#/accounts", "accounts");
    if (!r.ok) return fail(errText(r));
    body.append(el("h1", "admin__h1", "create an account"));
    body.append(el("p", "q__hint", "you'll get a one-time setup link to send them on WhatsApp or Telegram."));
    const pre = forMember ? r.data.unlinked.find((m) => String(m.id) === forMember) : null;
    const defs = [
      { key: "name", label: "their name", required: true },
      { key: "username", label: "username", hint: "what they sign in with. lowercase letters, numbers, dots.", required: true },
      { key: "role", label: "role", type: "select", options: ROLE_OPTIONS },
      { key: "member", label: "member profile", type: "select", options: [["new", "make a new profile in members"], ...r.data.unlinked.map((m) => [String(m.id), `link to ${m.name}`]), ["none", "no profile"]] },
    ];
    const { form: f, inputs } = buildForm(defs, { name: pre ? pre.name : "", username: pre ? usernameFrom(pre.name) : "", role: "member", member: pre ? String(pre.id) : "new" }, {
      submit: "create account",
      onSubmit: async (vals, status) => {
        const s = await api("/api/admin/accounts", { method: "POST", json: vals }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        listKey = null;
        $("h1", body).textContent = "account created";
        $(".q__hint", body).remove();
        f.replaceWith(linkPanel(s.data.account.name, s.data.link, s.data.expires));
        toast("account created.");
      },
    });
    let touched = Boolean(pre);
    inputs.username.addEventListener("input", () => { touched = true; });
    inputs.name.addEventListener("input", () => { if (!touched) inputs.username.value = usernameFrom(inputs.name.value); });
    inputs.member.addEventListener("change", () => {
      const m = r.data.unlinked.find((x) => String(x.id) === inputs.member.value);
      if (m && !inputs.name.value) { inputs.name.value = m.name; if (!touched) inputs.username.value = usernameFrom(m.name); }
    });
    body.append(f);
  }

  async function accountDetail(id) {
    fail("");
    const r = await get("/api/admin/accounts");
    if (!r) return;
    const body = detail("#/accounts", "accounts");
    if (!r.ok) return fail(errText(r));
    const a = r.data.accounts.find((x) => String(x.id) === id);
    if (!a) return fail("that account doesn't exist.");
    const head = el("header", "adetail__head");
    head.append(el("p", "kicker", `@${a.username}`), el("h1", "admin__h1", a.name));
    head.append(facts([
      ["role", ROLE_NAMES[a.role]],
      ["status", STATE_NAMES[a.state]],
      ["member profile", a.member_name, a.member_id ? `#/m/${a.member_id}` : null],
      ["created", `${when(a.created_at)}${a.created_by ? ` by ${a.created_by}` : ""}`],
      ["last signed in", a.last_login ? when(a.last_login) : "never"],
    ]));
    body.append(head);

    if (a.username === me.username) {
      body.append(el("p", "admin__fine", "this is you. another Master Admin can change your role or access."));
      return;
    }
    const sec = el("section", "adetail__section");
    const roleBar = el("div", "adetail__bar");
    const role = select("Role", ROLE_OPTIONS, a.role);
    role.id = "acct-role";
    const lab = el("label", "adetail__bar-label", "role");
    lab.htmlFor = "acct-role";
    role.addEventListener("change", async () => {
      const s = await api("/api/admin/accounts", { method: "PATCH", json: { id: a.id, role: role.value } }).catch(() => null);
      if (s && s.ok) { listKey = null; toast(`now ${ROLE_NAMES[role.value]}. they'll need to sign in again.`); } else { role.value = a.role; fail(errText(s)); }
    });
    roleBar.append(lab, role);
    sec.append(roleBar);

    const btns = el("div", "admin__formbar");
    const link = el("button", "btn btn--sm", a.state === "active" ? "new password link" : "new setup link");
    link.type = "button";
    link.id = "new-link";
    link.addEventListener("click", async () => {
      const s = await api("/api/admin/accounts", { method: "POST", json: { action: "link", id: a.id } }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      $(".admin__linkbox", body)?.remove();
      body.append(linkPanel(a.name, s.data.link, s.data.expires));
    });
    const toggle = el("button", "btn btn--ghost btn--sm", a.disabled ? "re-enable" : "disable");
    toggle.type = "button";
    toggle.id = "toggle-account";
    toggle.addEventListener("click", async () => {
      const s = await api("/api/admin/accounts", { method: "PATCH", json: { id: a.id, disabled: !a.disabled } }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      listKey = null;
      toast(a.disabled ? "re-enabled." : "disabled. they're signed out.");
      accountDetail(id);
    });
    const del = confirmButton("delete login", `delete ${a.name}'s login? their member profile stays.`, async () => {
      const s = await api(`/api/admin/accounts?id=${a.id}`, { method: "DELETE" }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      listKey = null;
      toast("deleted.");
      location.hash = "#/accounts";
    });
    btns.append(link, toggle, del);
    sec.append(btns);
    body.append(sec);
  }

  /* ───────────── which view ───────────── */
  const ROUTES = [
    [/^#\/(members)?$/, () => membersList(), "members"],
    [/^#\/m\/(new|\d+)$/, (m) => memberProfile(m[1]), "members"],
    [/^#\/applications$/, () => applicationsList(), "applications", ["master", "admin"]],
    [/^#\/a\/(\d+)$/, (m) => applicationDetail(m[1]), "applications", ["master", "admin"]],
    [/^#\/whats-on$/, () => whatsOn(), "whats-on", ["master", "admin"]],
    [/^#\/w\/(ip|event)\/(new|\d+)$/, (m) => whatsOnForm(m[1], m[2]), "whats-on", ["master", "admin"]],
    [/^#\/accounts$/, () => accountsList(), "accounts", ["master"]],
    [/^#\/accounts\/new(?:\/(\d+))?$/, (m) => accountForm(m[1]), "accounts", ["master"]],
    [/^#\/accounts\/(\d+)$/, (m) => accountDetail(m[1]), "accounts", ["master"]],
  ];

  function route() {
    if (!me) return;
    const hash = location.hash || "#/";
    const hit = ROUTES.find(([re, , , roles]) => re.test(hash) && (!roles || roles.includes(me.role)));
    if (!hit) { location.hash = "#/members"; return; }
    $$("#tabs a").forEach((a) => (a.dataset.tab === hit[2] ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    hit[1](hash.match(hit[0]));
  }
  addEventListener("hashchange", route);

  /* ───────────── start ───────────── */
  api("/api/admin/session")
    .then((r) => (r.ok ? signedIn(r.data.user) : signedOut()))
    .catch(() => signedOut());
})();

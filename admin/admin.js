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
  const fail = (msg) => { $("#error").textContent = msg || ""; };
  let toastTimer;
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2600);
  };
  function show(id) {
    $$("[data-view]").forEach((v) => { v.hidden = v.id !== id; });
    $("#side").hidden = id === "login";
    $("#app").classList.toggle("is-in", id !== "login");
  }

  let me = null;
  let form = null; // join-form.json, loaded the first time applications are opened
  const isAdmin = () => me && (me.role === "master" || me.role === "admin");
  const ROLE_NAMES = { master: "Master Admin", admin: "Admin", member: "Member" };
  const rid = (prefix, id) => `${prefix}-${String(id).padStart(4, "0")}`;

  const day = (d) => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "";
  const when = (d) => d ? new Date(d).toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }) : "";
  const handleOf = (t) => (t || "").replace(/^@/, "").trim();
  const waOf = (p) => {
    const d = (p || "").replace(/[^\d]/g, "");
    return d ? `https://wa.me/${d.length === 8 ? "65" + d : d}` : null;
  };
  const ERRORS = {
    username_taken: "That username is taken.",
    member_has_login: "That profile already has a login.",
    cant_change_self: "You can't change your own account here.",
    name_required: "A name is needed.",
    title_required: "A title is needed.",
    bad_date: "Pick a date.",
    bad_email: "That email doesn't look right.",
    bad_link: "Links must start with https:// (or be a page here, like backyard.html).",
    bad_recap: "Links must start with https:// (or be a page here, like backyard.html).",
    bad_image: "Images must be a full https:// address or a file in assets/.",
    not_allowed: "You don't have access to that.",
    not_configured: "The database isn't connected yet (add Neon in Vercel → Storage).",
    bad_role: "Pick a role from the list.",
    bad_unit: "That part of the org chart doesn't exist any more.",
    bad_parent: "Pick where this sits on the org chart.",
    bad_overseer: "Only Founders, Chiefs of Staff and Directors can oversee a domain.",
    unit_not_empty: "Move its people and teams out first.",
  };
  const errText = (r, fallback) => ERRORS[r && r.data && r.data.error] || fallback || "Couldn't save that. Try again.";

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
    show("login");
    fail("");
    $("#login-name").focus();
  }

  function signedIn(user) {
    me = user;
    $("#who-name").textContent = user.name;
    $("#who-name").href = user.memberId ? `#/m/${user.memberId}` : "#/";
    $("#who-role").textContent = ROLE_NAMES[user.role] || user.role;
    $("#who-initials").textContent = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    $$("#tabs [data-roles]").forEach((a) => { a.hidden = !a.dataset.roles.split(" ").includes(user.role); });
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
      r.status === 401 ? "That username and password don't match." :
      r.status === 429 ? "Too many tries. Wait 15 minutes and try again." :
      r.status === 503 ? "No logins are set up yet (ADMIN_USERS in Vercel)." :
      "Couldn't sign in just now. Try again.";
  });

  $("#sign-out").addEventListener("click", async () => {
    await api("/api/admin/session", { method: "DELETE" }).catch(() => {});
    signedOut();
  });

  /* ───────────── building blocks ───────────── */
  const pill = (text, kind) => el("span", `db-pill${kind ? " db-pill--" + kind.replace(/\s+/g, "-") : ""}`, text);
  const nodes = (...xs) => xs.flat().filter((x) => x !== null && x !== undefined && x !== false && x !== "");

  // columns: [{ label, cell: item => node | string, cls }]; hrefOf: item => "#/…" (the row opens it)
  function renderTable(thead, tbody, columns, items, hrefOf) {
    const hr = el("tr");
    for (const c of columns) {
      const th = el("th", c.cls && c.cls.includes("is-right") ? "is-right" : "", c.label);
      th.scope = "col";
      hr.append(th);
    }
    thead.replaceChildren(hr);
    tbody.replaceChildren(...items.map((item) => {
      const tr = el("tr");
      const href = hrefOf ? hrefOf(item) : null;
      if (href) tr.dataset.href = href;
      for (const c of columns) {
        const td = el("td", c.cls || "");
        let v = c.cell(item);
        if (c.link && href) {
          const a = el("a", "", typeof v === "string" ? v : null);
          a.href = href;
          if (typeof v !== "string") a.append(v);
          v = a;
        }
        if (Array.isArray(v)) td.append(...nodes(v));
        else if (v === null || v === undefined || v === "") td.append(el("span", "muted", "—"));
        else td.append(v);
        tr.append(td);
      }
      return tr;
    }));
  }
  // clicking anywhere on a row opens it (links and buttons inside still work as themselves)
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-href]");
    if (!tr || e.target.closest("a, button, input, select") || getSelection().toString()) return;
    location.hash = tr.dataset.href;
  });

  function fields(items, stack) {
    const dl = el("dl", `db-fields${stack ? " db-fields--stack" : ""}`);
    for (const [label, text, href] of items) {
      if (text === undefined) continue;
      const div = el("div");
      div.append(el("dt", "", label));
      const dd = el("dd", text ? "" : "is-empty");
      if (text && href) {
        const a = el("a", "", text);
        a.href = href;
        if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
        dd.append(a);
      } else if (text instanceof Node) {
        dd.append(text);
      } else {
        dd.textContent = text || "—";
      }
      div.append(dd);
      dl.append(div);
    }
    return dl;
  }

  function panel(title, content, headExtra) {
    const p = el("section", "db-panel");
    if (title) {
      const head = el("div", "db-panel__head");
      head.append(el("h2", "", title), ...nodes(headExtra));
      p.append(head);
    }
    if (content) {
      const body = el("div", "db-panel__body");
      body.append(...nodes(content));
      p.append(body);
    }
    return p;
  }

  function select(label, options, value, cls = "db-select") {
    const s = el("select", cls);
    s.setAttribute("aria-label", label);
    for (const o of options) s.append(new Option(Array.isArray(o) ? o[1] : o, Array.isArray(o) ? o[0] : o));
    if (value !== undefined) s.value = value;
    return s;
  }

  function button(text, kind, onClick, id) {
    const b = el("button", `db-btn${kind ? " db-btn--" + kind : ""}`, text);
    b.type = "button";
    if (id) b.id = id;
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  // asks for a second click instead of a confirm() box
  function confirmButton(text, warning, onYes) {
    const b = button(text, "danger");
    let armed = null;
    const reset = () => { clearTimeout(armed); armed = null; b.textContent = text; b.classList.remove("is-armed"); };
    b.addEventListener("click", () => {
      if (armed) { reset(); onYes(); return; }
      b.textContent = `Click again to ${text.toLowerCase()}`;
      b.classList.add("is-armed");
      if (warning) toast(warning);
      armed = setTimeout(reset, 5000);
    });
    return b;
  }
  const linkButton = (text, href, kind) => {
    const a = el("a", `db-btn${kind ? " db-btn--" + kind : ""}`, text);
    a.href = href;
    return a;
  };

  // defs: [{ key, label, type, options, hint, required, wide }]; values: current values
  function buildForm(defs, values, { submit, onSubmit, extra }) {
    const f = el("form", "db-form");
    f.noValidate = true;
    const inputs = {};
    for (const d of defs) {
      const wrap = el("div", `db-field${d.wide ? " db-field--wide" : ""}`);
      const id = `fld-${d.key}`;
      let input;
      if (d.type === "checkbox") {
        const lab = el("label", "db-check");
        input = el("input");
        input.type = "checkbox";
        input.checked = values ? values[d.key] !== false : true;
        lab.append(input, d.label);
        wrap.append(lab);
      } else if (d.type === "checks") {
        wrap.append(el("p", "db-label", d.label));
        input = el("div", "db-checks");
        input.dataset.checks = "1";
        const picked = (values && values[d.key]) || [];
        for (const [v, t] of d.options) {
          const lab = el("label", "db-check");
          const box = el("input");
          box.type = "checkbox";
          box.value = v;
          box.checked = picked.includes(v);
          lab.append(box, t);
          input.append(lab);
        }
        if (!d.options.length) input.append(el("span", "db-note", "No one to pick yet."));
        wrap.append(input);
        if (d.hint) wrap.append(el("p", "db-hint", d.hint));
      } else {
        const lab = el("label", "db-label", d.label);
        lab.htmlFor = id;
        if (!d.required && d.type !== "select") lab.append(el("small", "", "optional"));
        wrap.append(lab);
        if (d.type === "textarea") input = el("textarea", "db-input");
        else if (d.type === "select") input = select(d.label, d.options, undefined, "db-input");
        else {
          input = el("input", "db-input");
          input.type = d.type || "text";
          if (d.type === "text" || !d.type) input.autocomplete = "off";
        }
        if (d.list) input.setAttribute("list", d.list);
        const v = values ? values[d.key] : undefined;
        if (v !== undefined && v !== null) input.value = d.type === "date" ? String(v).slice(0, 10) : v;
        wrap.append(input);
        if (d.hint) wrap.append(el("p", "db-hint", d.hint));
      }
      input.id = id;
      input.name = d.key;
      inputs[d.key] = input;
      f.append(wrap);
    }
    const status = el("p", "db-error");
    status.setAttribute("role", "alert");
    const bar = el("div", "db-formbar");
    const go = el("button", "db-btn db-btn--primary", submit);
    go.type = "submit";
    bar.append(go, ...nodes(extra));
    f.append(status, bar);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      const vals = {};
      for (const [k, input] of Object.entries(inputs)) {
        vals[k] = input.dataset.checks ? [...input.querySelectorAll("input:checked")].map((i) => i.value)
          : input.type === "checkbox" ? input.checked : input.value.trim();
      }
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

  // a record page: crumb, title, small status line; returns the body to fill
  function detail(backHref, backText, idText, title, sub) {
    show("detail");
    window.scrollTo(0, 0);
    $("#back").href = backHref;
    $("#back").textContent = backText;
    $("#crumb-id").textContent = idText || "";
    $("#detail-title").textContent = title || "";
    $("#detail-sub").replaceChildren(...nodes(sub || []));
    const body = $("#detail-body");
    body.replaceChildren();
    return body;
  }
  function recordLayout(body) {
    const grid = el("div", "db-record");
    const main = el("div");
    const aside = el("aside", "db-record__aside");
    grid.append(main, aside);
    body.append(grid);
    return { main, aside };
  }

  // Lists keep their filters while you open a record and come back.
  let listKey = null;
  let loadRows = () => {};
  function openList(key, setup) {
    show("list");
    if (listKey !== key) {
      listKey = key;
      $("#filters").replaceChildren();
      $("#list-actions").replaceChildren();
      $("#thead").replaceChildren();
      $("#rows").replaceChildren();
      $("#count").textContent = "";
      $("#count-note").textContent = "";
      $("#empty").hidden = true;
      setup();
    }
    loadRows();
  }
  let filterTimer;
  function filterInputs(list) {
    $("#filters").replaceChildren(...list);
    list.forEach((n) => n.addEventListener("input", () => {
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
  function fillList(columns, items, hrefOf, total, emptyAll, emptyFiltered, note) {
    renderTable($("#thead"), $("#rows"), columns, items, hrefOf);
    const noun = total === 1 ? "record" : "records";
    $("#count").textContent = items.length !== total ? `Showing ${items.length} of ${total} ${noun}` : `${total} ${noun}`;
    $("#count-note").textContent = note || "";
    $("#empty").hidden = items.length > 0;
    $("#empty").textContent = total === 0 ? emptyAll : emptyFiltered;
  }
  const params = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
  // spreadsheets come straight from the server as a file
  const download = (url) => { location.href = url; };

  /* ───────────── members ───────────── */
  // the org chart's shape (matches lib/org.js)
  const ORG_ROLES = ["Founder", "Chief of Staff", "Director", "Team Lead", "Member", "Fellow", "Volunteer"];
  const LEADERSHIP = ["Founder", "Chief of Staff"];
  const OVERSEER_ROLES = ["Founder", "Chief of Staff", "Director"];
  const PARENT_KINDS = { division: [null], domain: ["division"], team: ["division", "domain"] };
  const roleKey = (r) => ({ "Founder": "founder", "Chief of Staff": "cos", "Director": "director", "Team Lead": "lead", "Fellow": "fellow", "Volunteer": "volunteer" }[r] || "member");
  const roleRank = (r) => { const i = ORG_ROLES.indexOf(r); return i < 0 ? 99 : i; };
  const unitLabel = (u) => [u.code, u.name].filter(Boolean).join(" ");
  const seatOf = (m) => (m.unit_id ? [m.unit_code, m.unit_name].filter(Boolean).join(" ") : "");

  const getOrg = async () => {
    const r = await get("/api/admin/org");
    return r && r.ok ? r.data : null;
  };
  // units in tree order, with depth, for menus
  function unitTree(units) {
    const kids = new Map();
    for (const u of units) {
      const k = u.parent_id ?? null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(u);
    }
    const out = [];
    const walk = (parent, depth) => (kids.get(parent) || []).forEach((u) => { out.push({ ...u, depth }); walk(u.id, depth + 1); });
    walk(null, 0);
    return out;
  }
  const unitOptions = (units, filter = () => true) =>
    unitTree(units).filter(filter).map((u) => [String(u.id), `${" ".repeat(u.depth)}${unitLabel(u)}`]);

  function memberFields(org) {
    return [
      { key: "name", label: "Full name", required: true },
      { key: "title", label: "Title", hint: "e.g. head of events" },
      { key: "org_role", label: "Role in Normal", type: "select", options: [["", "No role yet"], ...ORG_ROLES] },
      { key: "unit_id", label: "Seat on the org chart", type: "select", options: [["", "Not on the chart"], ...unitOptions(org ? org.units : [])], hint: "The division, domain or team they sit in." },
      { key: "telegram", label: "Telegram" },
      { key: "phone", label: "Phone (WhatsApp)", type: "tel" },
      { key: "email", label: "Email", type: "email" },
      { key: "dob", label: "Birthday", type: "date" },
      { key: "school", label: "School / organisation" },
      { key: "joined_on", label: "Joined Normal", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["active", "on break", "alumni"] },
      { key: "notes", label: "Notes", hint: "Only admins see these.", type: "textarea", wide: true },
    ];
  }

  // Table | Org chart
  function memberViews(active) {
    const seg = el("div", "db-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "View");
    for (const [key, text, href] of [["table", "Table", "#/members"], ["chart", "Org chart", "#/members/chart"]]) {
      const a = el("a", "", text);
      a.href = href;
      if (key === active) a.setAttribute("aria-current", "page");
      seg.append(a);
    }
    return seg;
  }

  function membersList() {
    openList("members", () => {
      $("#list-title").textContent = "members";
      const q = searchBox(isAdmin() ? "Search names, roles, teams, contacts…" : "Search names, roles, teams…");
      q.id = "f-q";
      const unit = select("Division, domain or team", [["", "Whole org"]]);
      unit.id = "f-unit";
      const status = select("Status", [["", "All statuses"], "active", "on break", "alumni"]);
      filterInputs([q, unit, status]);
      // the chart can change between visits, so its menu is refreshed with every load
      const refreshUnits = () => getOrg().then((org) => {
        if (!org) return;
        const keep = unit.value;
        unit.replaceChildren(new Option("Whole org", ""), ...unitOptions(org.units).map(([v, t]) => new Option(t, v)));
        unit.value = keep;
      });
      $("#list-actions").append(memberViews("table"));
      if (isAdmin()) {
        $("#list-actions").append(
          button("Export CSV", "", () => download("/api/admin/members?" + params({ format: "csv", q: q.value.trim(), unit: unit.value, status: status.value }))),
          linkButton("+ add member", "#/m/new", "primary"),
        );
      }
      const columns = [
        { label: "ID", cls: "is-id", cell: (m) => rid("M", m.id) },
        { label: "Name", cls: "is-name", link: true, cell: (m) => m.name },
        { label: "Role", cell: (m) => m.org_role && el("span", `org-role org-role--${roleKey(m.org_role)}`, m.org_role) },
        { label: "Seat", cell: (m) => seatOf(m) },
        { label: "Title", cell: (m) => m.title },
        { label: "Telegram", cell: (m) => m.telegram && "@" + handleOf(m.telegram) },
        ...(isAdmin() ? [
          { label: "Phone", cell: (m) => m.phone },
          { label: "Login", cell: (m) => m.login_role && pill(ROLE_NAMES[m.login_role], m.login_role) },
        ] : []),
        { label: "Status", cell: (m) => nodes(pill(m.status, m.status), Number(m.id) === me.memberId && pill("you", "you")) },
      ];
      loadRows = async () => {
        fail("");
        const [r] = await Promise.all([get("/api/admin/members?" + params({ q: q.value.trim(), unit: unit.value, status: status.value })), refreshUnits()]);
        if (!r) return;
        if (!r.ok) return fail(errText(r, "Couldn't load members."));
        fillList(columns, r.data.members, (m) => `#/m/${m.id}`, r.data.total,
          isAdmin() ? "No members yet. Add people, or accept them from applications." : "No members yet.",
          "No members match those filters.",
          isAdmin() ? "" : "Contact details are visible to admins only.");
      };
    });
  }

  async function memberProfile(id) {
    fail("");
    if (id === "new") {
      const org = await getOrg();
      const body = detail("#/members", "members", "new", "add member");
      const { form: f } = buildForm(memberFields(org), { status: "active", joined_on: new Date().toISOString().slice(0, 10) }, {
        submit: "Save record",
        extra: [linkButton("Cancel", "#/members")],
        onSubmit: async (vals, status) => {
          const r = await api("/api/admin/members", { method: "POST", json: vals }).catch(() => null);
          if (!r || !r.ok) { status.textContent = errText(r); return; }
          toast("Member added.");
          location.hash = `#/m/${r.data.id}`;
        },
      });
      body.append(panel("member record", f));
      return;
    }

    const [r, org] = await Promise.all([get(`/api/admin/members?id=${encodeURIComponent(id)}`), isAdmin() ? getOrg() : null]);
    if (!r) return;
    if (!r.ok) {
      detail("#/members", "members", rid("M", id), "not found");
      return fail(r.status === 404 ? "That person isn't in the directory." : errText(r, "Couldn't load that profile."));
    }
    const { member: m, canEdit } = r.data;
    const mine = Number(m.id) === me.memberId;
    const body = detail("#/members", "members", rid("M", m.id), m.name, [
      m.org_role && el("span", `org-role org-role--${roleKey(m.org_role)}`, m.org_role),
      [m.title, seatOf(m)].filter(Boolean).join(" · "),
      pill(m.status, m.status),
      mine && pill("you", "you"),
    ]);
    const { main, aside } = recordLayout(body);

    const tg = handleOf(m.telegram);
    main.append(panel("details", fields([
      ["Role in Normal", m.org_role || ""],
      ["Seat", seatOf(m), m.unit_id ? (isAdmin() ? `#/org/${m.unit_id}` : "#/members/chart") : null],
      ["Title", m.title || ""],
      ["Telegram", m.telegram ? "@" + tg : "", /^\w{3,}$/.test(tg) ? `https://t.me/${tg}` : null],
      ["WhatsApp", "phone" in m ? m.phone || "" : undefined, waOf(m.phone)],
      ["Email", "email" in m ? m.email || "" : undefined, m.email ? `mailto:${m.email}` : null],
      ["Birthday", "dob" in m ? day(m.dob) : undefined],
      ["School / org", "school" in m ? m.school || "" : undefined],
      ["Joined", "joined_on" in m ? day(m.joined_on) : undefined],
    ])));
    if (isAdmin()) main.append(panel("notes", m.notes ? el("p", "db-notes", m.notes) : el("p", "db-note", "No notes.")));

    if (canEdit.length) {
      const { form: f } = buildForm(memberFields(org).filter((d) => canEdit.includes(d.key)), m, {
        submit: "Save changes",
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/members", { method: "PATCH", json: { id: m.id, ...vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          toast("Saved.");
          memberProfile(id);
        },
      });
      const editPanel = panel(mine && !isAdmin() ? "update your details" : "edit record", nodes(
        mine && !isAdmin() && el("p", "db-note", "Other members see your name, title, role, seat and Telegram. Only admins see the rest."),
        f,
      ));
      if (mine && !isAdmin()) f.style.marginTop = "12px";
      main.append(editPanel);
    }

    if (isAdmin()) {
      const meta = fields([
        ["Record", rid("M", m.id)],
        ["Login", m.login ? `${m.login} (${ROLE_NAMES[m.login_role]})` : ""],
        ["Application", m.application_id ? rid("A", m.application_id) : "", m.application_id ? `#/a/${m.application_id}` : null],
        ["Created", when(m.created_at)],
        ["Last updated", when(m.updated_at)],
      ], true);
      const acts = el("div", "db-stack");
      if (!m.login && me.role === "master") acts.append(linkButton("Create login", `#/accounts/new/${m.id}`));
      acts.append(confirmButton("Delete record", "Their login (if any) stays, but loses its profile.", async () => {
        const d = await api(`/api/admin/members?id=${m.id}`, { method: "DELETE" }).catch(() => null);
        if (d && d.ok) { toast("Deleted."); location.hash = "#/members"; } else fail(errText(d));
      }));
      aside.append(panel("record", [meta]), panel("actions", acts));
    } else {
      aside.append(panel("record", fields([["Record", rid("M", m.id)], ["Status", m.status]], true)));
    }
  }

  /* ───────────── the org chart ───────────── */
  function personChip(p) {
    const a = el("a", `org-person org-person--${roleKey(p.org_role)}`);
    a.href = `#/m/${p.id}`;
    a.dataset.person = p.id;
    a.title = [p.org_role, p.title].filter(Boolean).join(" · ") || p.name;
    a.append(el("span", "org-av", p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()), el("span", "org-nm", p.name));
    if (p.org_role) a.append(el("span", "org-rl", p.org_role));
    return a;
  }
  function chips(list, empty) {
    const box = el("div", "org-chips");
    if (list.length) box.append(...list.map(personChip));
    else if (empty) box.append(el("span", "org-empty", empty));
    return box;
  }

  async function orgChart() {
    fail("");
    show("org");
    $("#org-actions").replaceChildren(memberViews("chart"), ...(isAdmin() ? [linkButton("+ add division", "#/org/new/division", "primary")] : []));
    $("#org-legend").replaceChildren(...ORG_ROLES.map((r) => {
      const s = el("span", `org-person org-person--${roleKey(r)} is-key`);
      s.append(el("span", "org-av"), el("span", "org-nm", r));
      return s;
    }));
    const org = await getOrg();
    if (!org) return fail("Couldn't load the org chart.");
    const { units, people } = org;
    const kids = new Map();
    for (const u of units) {
      const k = u.parent_id ?? null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(u);
    }
    const seated = new Map();
    for (const p of people) {
      if (p.unit_id === null) continue;
      if (!seated.has(p.unit_id)) seated.set(p.unit_id, []);
      seated.get(p.unit_id).push(p);
    }
    const byRole = (a, b) => roleRank(a.org_role) - roleRank(b.org_role) || a.name.localeCompare(b.name);
    seated.forEach((l) => l.sort(byRole));
    const names = new Map(people.map((p) => [p.id, p.name]));

    const head = (u) => {
      const h = el("div", "org-unit__head");
      if (u.code) h.append(el("span", "org-code", u.code));
      if (isAdmin()) {
        const a = el("a", "org-name", u.name);
        a.href = `#/org/${u.id}`;
        h.append(a);
      } else {
        h.append(el("span", "org-name", u.name));
      }
      h.append(el("span", "org-kind", u.kind));
      return h;
    };
    const addLink = (text, href) => {
      const a = el("a", "org-add", text);
      a.href = href;
      return a;
    };
    function unitNode(u) {
      const box = el("div", `org-unit org-unit--${u.kind}`);
      box.dataset.unit = u.id;
      if (u.overseers.length) box.dataset.overseers = u.overseers.join(" ");
      const bodyEl = el("div", "org-unit__body");
      if (u.kind === "domain" && u.overseers.length) {
        bodyEl.append(el("p", "org-over", `Overseen by ${u.overseers.map((id) => names.get(id)).filter(Boolean).join(", ")}`));
      }
      const here = seated.get(u.id) || [];
      const children = kids.get(u.id) || [];
      if (here.length || u.kind === "team" || !children.length) bodyEl.append(chips(here, u.kind === "team" ? "No one yet" : children.length ? "" : "No one yet"));
      if (children.length) {
        const list = el("div", "org-kids");
        list.append(...children.map(unitNode));
        bodyEl.append(list);
      }
      if (isAdmin() && u.kind !== "team") {
        const adds = el("div", "org-adds");
        if (u.kind === "division") adds.append(addLink("+ domain", `#/org/new/domain/${u.id}`));
        adds.append(addLink("+ team", `#/org/new/team/${u.id}`));
        bodyEl.append(adds);
      }
      box.append(head(u), bodyEl);
      return box;
    }

    const chart = $("#org-chart");
    const top = el("div", "org-top");
    const leaders = people.filter((p) => p.unit_id === null && LEADERSHIP.includes(p.org_role)).sort(byRole);
    const topCard = el("div", "org-unit org-unit--root");
    const topHead = el("div", "org-unit__head");
    topHead.append(el("span", "org-name", "Normal"), el("span", "org-kind", "leadership"));
    const topBody = el("div", "org-unit__body");
    topBody.append(chips(leaders, "Give someone the Founder or Chief of Staff role to show them here."));
    topCard.append(topHead, topBody);
    top.append(topCard);
    const divisions = kids.get(null) || [];
    if (divisions.length) {
      const row = el("div", "org-row");
      row.append(...divisions.map((d) => {
        const col = el("div", "org-col");
        col.append(unitNode(d));
        return col;
      }));
      chart.replaceChildren(top, el("div", "org-stem"), row);
    } else {
      chart.replaceChildren(top, el("p", "db-empty", isAdmin() ? "No divisions yet. Add one to start the chart." : "The org chart hasn't been set up yet."));
    }

    // hover a director to light up what they oversee
    chart.querySelectorAll(".org-person[data-person]").forEach((chip) => {
      const lit = () => chart.querySelectorAll(".org-unit[data-overseers]").forEach((u) => u.classList.toggle("is-lit", u.dataset.overseers.split(" ").includes(chip.dataset.person)));
      chip.addEventListener("mouseenter", lit);
      chip.addEventListener("focus", lit);
      const off = () => chart.querySelectorAll(".is-lit").forEach((u) => u.classList.remove("is-lit"));
      chip.addEventListener("mouseleave", off);
      chip.addEventListener("blur", off);
    });

    const onChart = people.filter((p) => p.unit_id !== null || LEADERSHIP.includes(p.org_role));
    const unplaced = people.filter((p) => p.unit_id === null && !LEADERSHIP.includes(p.org_role)).sort(byRole);
    const count = (k) => { const n = units.filter((u) => u.kind === k).length; return `${n} ${k}${n === 1 ? "" : "s"}`; };
    $("#org-count").textContent = `${onChart.length} ${onChart.length === 1 ? "person" : "people"} on the chart · ${count("division")} · ${count("domain")} · ${count("team")}`;
    $("#org-note").textContent = isAdmin() ? "Seat people from their member record." : "";
    $("#org-unplaced").hidden = !unplaced.length;
    $("#org-unplaced-note").textContent = isAdmin() ? "Open someone and set their seat to place them." : "";
    $("#org-unplaced-list").replaceChildren(...unplaced.map(personChip));
  }

  async function unitForm(id, kindArg, parentArg) {
    fail("");
    const org = await getOrg();
    if (!org) return fail("Couldn't load the org chart.");
    const isNew = id === "new";
    const unit = isNew ? { kind: kindArg, parent_id: parentArg ? Number(parentArg) : null, overseers: [] } : org.units.find((u) => String(u.id) === id);
    const kind = unit ? unit.kind : kindArg;
    const body = detail("#/members/chart", "org chart", isNew ? "new" : unit ? unit.code || `#${unit.id}` : "", isNew ? `add ${kind}` : unit ? unit.name : "not found", unit && !isNew ? [el("span", "db-pill", kind)] : []);
    if (!unit) return fail("That part of the org chart isn't there any more.");

    const defs = [
      { key: "name", label: "Name", required: true },
      { key: "code", label: "Code", hint: "Short reference, e.g. FL or FL.1" },
    ];
    if (kind !== "division") {
      const allowed = PARENT_KINDS[kind];
      defs.push({ key: "parent_id", label: kind === "domain" ? "Division" : "Sits under", type: "select", options: unitOptions(org.units, (u) => allowed.includes(u.kind)) });
    }
    if (kind === "domain") {
      const eligible = org.people.filter((p) => OVERSEER_ROLES.includes(p.org_role)).sort((a, b) => a.name.localeCompare(b.name));
      defs.push({ key: "overseers", label: "Overseen by", type: "checks", wide: true, options: eligible.map((p) => [String(p.id), `${p.name} (${p.org_role})`]),
        hint: eligible.length ? "" : "Give someone the Director role on their record to pick them here." });
    }
    defs.push({ key: "note", label: "Note", type: "textarea", wide: true });

    const values = { ...unit, parent_id: unit.parent_id === null ? "" : String(unit.parent_id), overseers: (unit.overseers || []).map(String) };
    const extra = [linkButton("Cancel", "#/members/chart")];
    if (!isNew) extra.push(confirmButton(`Delete ${kind}`, "Only empty ones can be deleted: move its people and teams first.", async () => {
      const d = await api(`/api/admin/org?id=${unit.id}`, { method: "DELETE" }).catch(() => null);
      if (d && d.ok) { toast("Deleted."); location.hash = "#/members/chart"; }
      else fail(d && d.data && d.data.error === "unit_not_empty" ? `Move its people and ${kind === "division" ? "domains and teams" : "teams"} out first.` : errText(d));
    }));
    const { form: f } = buildForm(defs, values, {
      submit: isNew ? `Save ${kind}` : "Save changes",
      extra,
      onSubmit: async (vals, status) => {
        const json = { ...vals, ...(isNew ? { kind } : { id: unit.id }) };
        if (kind === "division") json.parent_id = null;
        const s = await api("/api/admin/org", { method: isNew ? "POST" : "PATCH", json }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        toast(isNew ? `${kind[0].toUpperCase() + kind.slice(1)} added.` : "Saved.");
        location.hash = "#/members/chart";
      },
    });

    if (isNew) { body.append(panel(`${kind} record`, f)); return; }
    const { main, aside } = recordLayout(body);
    main.append(panel(`${kind} record`, f));
    const here = org.people.filter((p) => p.unit_id === unit.id);
    aside.append(panel("seated here", here.length ? chips(here) : el("p", "db-note", "No one is seated here. Set someone's seat on their member record.")));
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
    try { await loadForm(); } catch { return fail("Couldn't load the form questions. Refresh the page."); }
    openList("applications", () => {
      $("#list-title").textContent = "applications";
      const q = searchBox("Search names, handles, answers…");
      const stage = select("Life stage", [["", "All life stages"], ...formQs().find((x) => x.column === "life_stage").options]);
      const role = select("Role", [["", "All roles"], ...formQs().find((x) => x.roles).rows.map((r) => [r, roleName(r)])]);
      const status = select("Status", [["", "All statuses"], "new", "interviewing", "accepted", "declined"]);
      q.id = "f-q"; stage.id = "f-stage"; role.id = "f-role"; status.id = "f-status";
      filterInputs([q, stage, role, status]);
      const vals = () => ({ q: q.value.trim(), stage: stage.value, role: role.value, status: status.value });
      $("#list-actions").append(button("Export CSV", "", () => download("/api/admin/export?" + params(vals())), "export"));
      const columns = [
        { label: "ID", cls: "is-id", cell: (a) => rid("A", a.id) },
        { label: "Name", cls: "is-name is-nowrap", link: true, cell: (a) => a.name },
        { label: "Life stage", cell: (a) => a.life_stage },
        { label: "School / org", cell: (a) => a.school },
        { label: "Telegram", cls: "is-nowrap", cell: (a) => a.telegram },
        { label: "1st choice role", cell: (a) => {
          const roles = topRoles(a.roles);
          if (!roles.length) return "";
          const s = el("span", "db-roles", roles[0].role);
          s.title = roles.map((t) => `${t.n}. ${t.role}`).join("\n");
          return s;
        } },
        { label: "Status", cls: "is-nowrap", cell: (a) => pill(a.status, a.status) },
        { label: "Submitted", cls: "is-nowrap is-muted", cell: (a) => new Date(a.created_at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) },
      ];
      loadRows = async () => {
        fail("");
        const r = await get("/api/admin/applications?" + params(vals()));
        if (!r) return;
        if (!r.ok) return fail(errText(r, "Couldn't load applications."));
        fillList(columns, r.data.applications, (a) => `#/a/${a.id}`, r.data.total,
          "No applications yet. They appear here as people apply on the join page.", "No applications match those filters.");
      };
    });
  }

  function answerNode(q, v) {
    if (v === undefined || v === null || v === "") return null;
    if (q.type === "matrix") {
      const order = q.roles ? (r) => q.columns.indexOf(v[r]) : (r) => q.rows.indexOf(r);
      const ul = el("ul", "db-grid");
      Object.keys(v).sort((a, b) => order(a) - order(b)).forEach((r) => {
        const li = el("li");
        li.append(el("span", "", q.roles ? roleName(r) : r), el("span", "", v[r]));
        ul.append(li);
      });
      return ul;
    }
    if (q.type === "consent") return v ? "✓ agreed to the notice" : null;
    if (q.type === "date") return new Date(v + "T00:00:00").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" });
    return String(v);
  }

  async function applicationDetail(id) {
    fail("");
    try { await loadForm(); } catch { return fail("Couldn't load the form questions. Refresh the page."); }
    const r = await get(`/api/admin/applications?id=${encodeURIComponent(id)}`);
    if (!r) return;
    if (!r.ok) {
      detail("#/applications", "applications", rid("A", id), "not found");
      return fail(r.status === 404 ? "That application doesn't exist." : errText(r, "Couldn't load that application."));
    }
    const a = r.data.application;
    const ans = typeof a.answers === "string" ? JSON.parse(a.answers) : a.answers;
    const body = detail("#/applications", "applications", rid("A", a.id), a.name, [pill(a.status, a.status), `submitted ${when(a.created_at)}`]);
    const { main, aside } = recordLayout(body);

    const handle = handleOf(a.telegram);
    let born = "";
    if (a.dob) {
      const dob = new Date(String(a.dob).slice(0, 10) + "T00:00:00");
      born = `${day(a.dob)} (age ${Math.floor((Date.now() - dob) / (365.25 * 864e5))})`;
    }
    main.append(panel("applicant", fields([
      ["WhatsApp", a.phone || "", waOf(a.phone)],
      ["Telegram", a.telegram || "", /^\w{3,}$/.test(handle) ? `https://t.me/${handle}` : null],
      ["Born", born],
      ["Life stage", a.life_stage || ""],
      ["School / org", a.school || ""],
    ])));

    const skip = new Set(["name", "phone", "telegram", "dob", "life_stage", "school"]);
    form.steps.forEach((step) => {
      const qsInStep = step.questions.filter((q) => !(q.column && skip.has(q.column)));
      if (!qsInStep.length) return;
      const p = el("section", "db-panel");
      const head = el("div", "db-panel__head");
      head.append(el("h2", "", step.heading));
      const dl = el("dl", "db-qa");
      for (const q of qsInStep) {
        const row = el("div");
        const v = answerNode(q, ans[q.id]);
        const dd = el("dd", v ? "" : "is-empty");
        if (v instanceof Node) dd.append(v); else dd.textContent = v || "—";
        row.append(el("dt", "", q.label), dd);
        dl.append(row);
      }
      p.append(head, dl);
      main.append(p);
    });

    // review: status, and accepting into members
    const review = el("div", "db-stack");
    const lab = el("label", "db-label", "Status");
    lab.htmlFor = "app-status";
    const status = select("Status", r.data.statuses, a.status, "db-input");
    status.id = "app-status";
    status.addEventListener("change", async () => {
      const s = await api("/api/admin/applications", { method: "PATCH", json: { id: a.id, status: status.value } }).catch(() => null);
      if (s && s.ok) { toast(`Marked ${status.value}.`); $("#detail-sub .db-pill").replaceWith(pill(status.value, status.value)); } else fail(errText(s));
    });
    review.append(lab, status);
    if (a.member_id) {
      review.append(linkButton("Open member record", `#/m/${a.member_id}`));
    } else {
      const accept = button("Accept → add to members", "primary", async () => {
        accept.disabled = true;
        const s = await api("/api/admin/applications", { method: "POST", json: { action: "accept", id: a.id } }).catch(() => null);
        accept.disabled = false;
        if (!s || !s.ok) return fail(errText(s));
        toast(`${a.name} is now in members.`);
        location.hash = `#/m/${s.data.memberId}`;
      }, "accept");
      review.append(accept);
    }
    aside.append(
      panel("review", review),
      panel("record", fields([["Record", rid("A", a.id)], ["Submitted", when(a.created_at)], ["Member record", a.member_id ? rid("M", a.member_id) : "", a.member_id ? `#/m/${a.member_id}` : null]], true)),
    );
  }

  /* ───────────── what's on ───────────── */
  const IP_FIELDS = [
    { key: "name", label: "Name", required: true },
    { key: "theme", label: "Card style", type: "select", options: [["", "Plain Normal card"], ["backyard", "Backyard (backyard.sg colours)"], ["youthday", "Youth Day (youthday.sg colours)"]] },
    { key: "kicker", label: "Line above the name", hint: "e.g. we invite you to our" },
    { key: "blurb", label: "Line below the name", hint: "A year at the end (… 2027) gets its own colour on themed cards." },
    { key: "link", label: "Link", hint: "Its own site, e.g. https://youthday.sg. Empty shows \"page coming soon\"." },
    { key: "image", label: "Image", hint: "A full https:// address, or a file in assets/ips/." },
    { key: "visible", label: "Show on the what's on page", type: "checkbox", wide: true },
  ];
  const EVENT_FIELDS = [
    { key: "title", label: "Title", required: true },
    { key: "date", label: "Date", type: "date", required: true },
    { key: "time", label: "Time", hint: "e.g. 7–10pm" },
    { key: "place", label: "Place" },
    { key: "blurb", label: "Description", type: "textarea", wide: true },
    { key: "link", label: "Sign-up link", hint: "Shown while it's upcoming." },
    { key: "recap", label: "Recap link", hint: "Shown once it's past: photos, a post, a video." },
    { key: "image", label: "Photo", hint: "A full https:// address, or a file in assets/events/." },
    { key: "visible", label: "Show on the what's on page", type: "checkbox", wide: true },
  ];
  const visiblePill = (x) => (x.visible ? pill("shown", "shown") : pill("hidden", "hidden"));

  async function whatsOn() {
    fail("");
    show("whats-on");
    const r = await get("/api/admin/whats-on");
    if (!r) return;
    if (!r.ok) return fail(errText(r, "Couldn't load what's on."));
    const { ips, events } = r.data;

    const move = async (id, by) => {
      const s = await api("/api/admin/whats-on", { method: "PATCH", json: { kind: "ip", id, move: by } }).catch(() => null);
      if (s && s.ok) whatsOn(); else fail(errText(s));
    };
    const arrow = (ip, i, by) => {
      const b = el("button", "db-icon-btn", by < 0 ? "↑" : "↓");
      b.type = "button";
      b.disabled = by < 0 ? i === 0 : i === ips.length - 1;
      b.setAttribute("aria-label", `move ${ip.name} ${by < 0 ? "up" : "down"}`);
      b.addEventListener("click", () => move(ip.id, by));
      return b;
    };
    const STYLE = { backyard: "Backyard", youthday: "Youth Day" };
    renderTable($("#ip-head"), $("#ip-rows"), [
      { label: "Order", cls: "is-id", cell: (ip) => String(ips.indexOf(ip) + 1) },
      { label: "Name", cls: "is-name is-nowrap", link: true, cell: (ip) => ip.name },
      { label: "Card style", cls: "is-nowrap", cell: (ip) => STYLE[ip.theme] || "plain" },
      { label: "Lines", cell: (ip) => [ip.kicker, ip.blurb].filter(Boolean).join(" / ") },
      { label: "Link", cls: "is-muted", cell: (ip) => ip.link },
      { label: "Status", cls: "is-nowrap", cell: visiblePill },
      { label: "Move", cls: "is-nowrap is-right", cell: (ip) => { const c = el("span", "db-row-ctl"); c.append(arrow(ip, ips.indexOf(ip), -1), arrow(ip, ips.indexOf(ip), 1)); return c; } },
    ], ips, (ip) => `#/w/ip/${ip.id}`);
    if (!ips.length) $("#ip-rows").append(emptyRow(7, "No IPs yet. The section stays hidden on the public page until there's one."));

    const today = new Date().toISOString().slice(0, 10);
    renderTable($("#event-head"), $("#event-rows"), [
      { label: "ID", cls: "is-id", cell: (e) => rid("E", e.id) },
      { label: "Date", cls: "is-nowrap", cell: (e) => day(e.date) },
      { label: "Title", cls: "is-name", link: true, cell: (e) => e.title },
      { label: "Time", cls: "is-nowrap is-muted", cell: (e) => e.time },
      { label: "Place", cell: (e) => e.place },
      { label: "When", cls: "is-nowrap", cell: (e) => (e.date >= today ? pill("upcoming", "upcoming") : pill("past", "past")) },
      { label: "Status", cls: "is-nowrap", cell: visiblePill },
    ], events, (e) => `#/w/event/${e.id}`);
    if (!events.length) $("#event-rows").append(emptyRow(7, "No events yet. Add one: it shows under \"coming up\", then moves to \"so far\" once the day passes."));
  }
  function emptyRow(span, text) {
    const tr = el("tr");
    const td = el("td", "db-empty", text);
    td.colSpan = span;
    tr.append(td);
    return tr;
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
    const noun = kind === "ip" ? "IP" : "event";
    const code = isNew ? "new" : kind === "ip" ? rid("IP", id) : rid("E", id);
    const body = detail("#/whats-on", "what's on", code, isNew ? `add ${noun}` : item ? item.name || item.title : "not found", item && !isNew ? [visiblePill(item)] : []);
    if (!item) return fail("That isn't there any more.");
    const extra = [linkButton("Cancel", "#/whats-on")];
    if (!isNew) extra.push(confirmButton(`Delete ${noun}`, "It comes off the public page straight away.", async () => {
      const d = await api(`/api/admin/whats-on?kind=${kind}&id=${item.id}`, { method: "DELETE" }).catch(() => null);
      if (d && d.ok) { toast("Deleted."); location.hash = "#/whats-on"; } else fail(errText(d));
    }));
    const { form: f } = buildForm(kind === "ip" ? IP_FIELDS : EVENT_FIELDS, item, {
      submit: isNew ? `Save ${noun}` : "Save changes",
      extra,
      onSubmit: async (vals, status) => {
        const s = await api("/api/admin/whats-on", { method: isNew ? "POST" : "PATCH", json: { kind, ...(isNew ? {} : { id: item.id }), ...vals } }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        toast(isNew ? "Added. It's on the public page within a minute." : "Saved. The public page updates within a minute.");
        location.hash = "#/whats-on";
      },
    });
    body.append(panel(`${noun} record`, f));
  }

  /* ───────────── accounts (Master Admins) ───────────── */
  const STATE_NAMES = { active: "active", invited: "link sent", expired: "link expired", disabled: "disabled" };

  function accountsList() {
    openList("accounts", () => {
      $("#list-title").textContent = "accounts";
      $("#filters").replaceChildren();
      const add = linkButton("+ create account", "#/accounts/new", "primary");
      add.id = "new-account";
      $("#list-actions").append(add);
      const columns = [
        { label: "ID", cls: "is-id", cell: (a) => (a.fixed ? "env" : rid("U", a.id)) },
        { label: "Name", cls: "is-name is-nowrap", link: true, cell: (a) => a.name },
        { label: "Username", cls: "is-nowrap", cell: (a) => el("span", "mono", a.username) },
        { label: "Role", cls: "is-nowrap", cell: (a) => pill(ROLE_NAMES[a.role], a.role) },
        { label: "Status", cls: "is-nowrap", cell: (a) => nodes(a.fixed ? pill("set in Vercel", "active") : pill(STATE_NAMES[a.state], a.state), a.username === me.username && pill("you", "you")) },
        { label: "Member record", cls: "is-nowrap", cell: (a) => (a.member_id ? `${a.member_name} (${rid("M", a.member_id)})` : "") },
        { label: "Last sign-in", cls: "is-nowrap is-muted", cell: (a) => (a.fixed ? "" : a.last_login ? when(a.last_login) : "never") },
      ];
      loadRows = async () => {
        fail("");
        const r = await get("/api/admin/accounts");
        if (!r) return;
        if (!r.ok) return fail(errText(r, "Couldn't load accounts."));
        const fixed = r.data.fixed.map((u) => ({ fixed: true, username: u, name: u, role: "master" }));
        const all = [...fixed, ...r.data.accounts];
        fillList(columns, all, (a) => (a.fixed ? null : `#/accounts/${a.id}`), all.length, "No accounts yet.", "",
          fixed.length ? "“env” logins are set in Vercel (ADMIN_USERS) and can't be changed here." : "");
      };
    });
  }

  function linkPanel(name, link, expires) {
    const box = el("div", "db-stack admin__linkbox");
    box.append(el("p", "db-note", `Send this to ${name}. It works once, until ${when(expires)}, and they choose their own password. Send it privately, not in a group chat.`));
    const input = el("input", "db-input mono");
    input.type = "text";
    input.readOnly = true;
    input.value = link;
    input.id = "setup-link";
    input.setAttribute("aria-label", "Setup link");
    input.addEventListener("focus", () => input.select());
    const first = name.split(" ")[0];
    const msg = `hi ${first}! here's your login for the Normal admin portal. open it to set your password (works once, for 7 days): ${link}`;
    const wa = el("a", "db-btn", "Send on WhatsApp");
    wa.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    wa.target = "_blank"; wa.rel = "noopener noreferrer";
    const tg = el("a", "db-btn", "Send on Telegram");
    tg.href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`hi ${first}! here's your login for the Normal admin portal. open it to set your password (works once, for 7 days).`)}`;
    tg.target = "_blank"; tg.rel = "noopener noreferrer";
    const copy = button("Copy link", "primary", async () => {
      try { await navigator.clipboard.writeText(link); toast("Copied."); } catch { input.select(); }
    });
    const btns = el("div", "db-actions");
    btns.append(copy, wa, tg);
    box.append(input, btns);
    return panel("setup link", box);
  }

  const ROLE_OPTIONS = [
    ["member", "Member: members directory, edits own details"],
    ["admin", "Admin: members, applications, what's on"],
    ["master", "Master Admin: everything, plus accounts"],
  ];
  const usernameFrom = (name) => name.toLowerCase().normalize("NFKD").replace(/[^\w\s.-]/g, "").trim().split(/\s+/).join(".").replace(/[^a-z0-9._-]/g, "").slice(0, 32);

  async function accountForm(forMember) {
    fail("");
    const r = await get("/api/admin/accounts");
    if (!r) return;
    const body = detail("#/accounts", "accounts", "new", "create account");
    if (!r.ok) return fail(errText(r));
    const pre = forMember ? r.data.unlinked.find((m) => String(m.id) === forMember) : null;
    const defs = [
      { key: "name", label: "Name", required: true },
      { key: "username", label: "Username", hint: "What they sign in with: lowercase letters, numbers, dots.", required: true },
      { key: "role", label: "Role", type: "select", options: ROLE_OPTIONS },
      { key: "member", label: "Member record", type: "select", options: [["new", "Create a new member record"], ...r.data.unlinked.map((m) => [String(m.id), `${m.name} (${rid("M", m.id)})`]), ["none", "No member record"]] },
    ];
    const { form: f, inputs } = buildForm(defs, { name: pre ? pre.name : "", username: pre ? usernameFrom(pre.name) : "", role: "member", member: pre ? String(pre.id) : "new" }, {
      submit: "Create account",
      extra: [linkButton("Cancel", "#/accounts")],
      onSubmit: async (vals, status) => {
        const s = await api("/api/admin/accounts", { method: "POST", json: vals }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        listKey = null;
        $("#detail-title").textContent = s.data.account.name;
        $("#crumb-id").textContent = rid("U", s.data.account.id);
        $("#detail-sub").replaceChildren(pill(ROLE_NAMES[s.data.account.role], s.data.account.role), pill("link sent", "invited"));
        accountPanel.replaceWith(linkPanel(s.data.account.name, s.data.link, s.data.expires));
        toast("Account created.");
      },
    });
    let touched = Boolean(pre);
    inputs.username.addEventListener("input", () => { touched = true; });
    inputs.name.addEventListener("input", () => { if (!touched) inputs.username.value = usernameFrom(inputs.name.value); });
    inputs.member.addEventListener("change", () => {
      const m = r.data.unlinked.find((x) => String(x.id) === inputs.member.value);
      if (m && !inputs.name.value) { inputs.name.value = m.name; if (!touched) inputs.username.value = usernameFrom(m.name); }
    });
    const accountPanel = panel("account record", [el("p", "db-note", "You'll get a one-time setup link to send them on WhatsApp or Telegram."), f]);
    f.style.marginTop = "12px";
    body.append(accountPanel);
  }

  async function accountDetail(id) {
    fail("");
    const r = await get("/api/admin/accounts");
    if (!r) return;
    if (!r.ok) return fail(errText(r));
    const a = r.data.accounts.find((x) => String(x.id) === id);
    if (!a) { detail("#/accounts", "accounts", rid("U", id), "not found"); return fail("That account doesn't exist."); }
    const body = detail("#/accounts", "accounts", rid("U", a.id), a.name, [pill(ROLE_NAMES[a.role], a.role), pill(STATE_NAMES[a.state], a.state), a.username === me.username && pill("you", "you")]);
    const { main, aside } = recordLayout(body);
    main.append(panel("details", fields([
      ["Username", el("span", "mono", a.username)],
      ["Role", ROLE_NAMES[a.role]],
      ["Status", STATE_NAMES[a.state]],
      ["Member record", a.member_name ? `${a.member_name} (${rid("M", a.member_id)})` : "", a.member_id ? `#/m/${a.member_id}` : null],
      ["Created", `${when(a.created_at)}${a.created_by ? ` by ${a.created_by}` : ""}`],
      ["Last sign-in", a.last_login ? when(a.last_login) : "never"],
    ])));

    if (a.username === me.username) {
      aside.append(panel("access", el("p", "db-note", "This is you. Another Master Admin can change your role or access.")));
      return;
    }
    const acts = el("div", "db-stack");
    const lab = el("label", "db-label", "Role");
    lab.htmlFor = "acct-role";
    const role = select("Role", ROLE_OPTIONS.map(([v]) => [v, ROLE_NAMES[v]]), a.role, "db-input");
    role.id = "acct-role";
    role.addEventListener("change", async () => {
      const s = await api("/api/admin/accounts", { method: "PATCH", json: { id: a.id, role: role.value } }).catch(() => null);
      if (s && s.ok) { listKey = null; toast(`Now ${ROLE_NAMES[role.value]}. They'll need to sign in again.`); } else { role.value = a.role; fail(errText(s)); }
    });
    const link = button(a.state === "active" ? "New password link" : "New setup link", "", async () => {
      const s = await api("/api/admin/accounts", { method: "POST", json: { action: "link", id: a.id } }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      $(".admin__linkbox", main)?.closest(".db-panel").remove();
      main.append(linkPanel(a.name, s.data.link, s.data.expires));
    }, "new-link");
    const toggle = button(a.disabled ? "Re-enable account" : "Disable account", "", async () => {
      const s = await api("/api/admin/accounts", { method: "PATCH", json: { id: a.id, disabled: !a.disabled } }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      listKey = null;
      toast(a.disabled ? "Re-enabled." : "Disabled. They're signed out.");
      accountDetail(id);
    }, "toggle-account");
    const del = confirmButton("Delete account", "Their member record stays.", async () => {
      const s = await api(`/api/admin/accounts?id=${a.id}`, { method: "DELETE" }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      listKey = null;
      toast("Deleted.");
      location.hash = "#/accounts";
    });
    acts.append(lab, role, link, toggle, del, el("p", "db-note", "Changing the role or disabling signs them out straight away."));
    aside.append(panel("access", acts));
  }

  /* ───────────── which view ───────────── */
  const ROUTES = [
    [/^#\/(members)?$/, () => membersList(), "members"],
    [/^#\/m\/(new|\d+)$/, (m) => memberProfile(m[1]), "members"],
    [/^#\/members\/chart$/, () => orgChart(), "members"],
    [/^#\/org\/new\/(division|domain|team)(?:\/(\d+))?$/, (m) => unitForm("new", m[1], m[2]), "members", ["master", "admin"]],
    [/^#\/org\/(\d+)$/, (m) => unitForm(m[1]), "members", ["master", "admin"]],
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

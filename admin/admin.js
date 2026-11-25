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
    bad_field: (f) => `Check "${f}".`,
    required: (f) => `"${f}" is needed.`,
    bad_url: (f) => `"${f}" must be a full link starting with https://.`,
    bad_person: "One of those people isn't in the directory any more.",
    bad_record_link: "That event or project isn't there any more.",
    keep_yourself: "Keep yourself on it, or ask an admin to hand it over.",
    empty_note: "Write something first.",
    bad_seats: "A person can hold up to 10 seats.",
    bad_import: "That file couldn't be imported. Nothing was changed.",
  };
  const errText = (r, fallback) => {
    const e = r && r.data ? ERRORS[r.data.error] : null;
    return (typeof e === "function" ? e(r.data.field || "that") : e) || fallback || "Couldn't save that. Try again.";
  };

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

  async function signedIn(user) {
    me = user;
    const s = await api("/api/admin/records?schema=1").catch(() => null);
    schema = s && s.ok ? s.data.collections : {};
    buildNav();
    $("#who-name").textContent = user.name;
    $("#who-name").href = user.memberId ? `#/m/${user.memberId}` : "#/";
    $("#who-role").textContent = ROLE_NAMES[user.role] || user.role;
    $("#who-initials").textContent = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
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
        if (d.options.length > 12) {
          const find = el("input", "db-input db-checks__find");
          find.type = "search";
          find.placeholder = "Find…";
          find.setAttribute("aria-label", `Find in ${d.label}`);
          const box = input;
          find.addEventListener("input", () => $$(".db-check", box).forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(find.value.toLowerCase()) && !$("input", l).checked; }));
          wrap.append(find);
          input.classList.add("is-long");
        }
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
          if (d.step) input.step = d.step;
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
  const OVERSEER_ROLES = ["Founder", "Chief of Staff", "Director"];
  const PARENT_KINDS = { division: [null], domain: ["division"], team: ["division", "domain"] };
  const MEMBER_STATUSES = ["active", "leaning in", "leaning no", "on break", "alumni"];
  const roleKey = (r) => ({ "Founder": "founder", "Chief of Staff": "cos", "Director": "director", "Team Lead": "lead", "Fellow": "fellow", "Volunteer": "volunteer" }[r] || "member");
  const roleRank = (r) => { const i = ORG_ROLES.indexOf(r); return i < 0 ? 99 : i; };
  const statusKey = (s) => String(s || "").replace(/\s+/g, "-");
  const unitLabel = (u) => [u.code, u.name].filter(Boolean).join(" ");
  const seatLabel = (s) => (s.unit_id ? [s.unit_code, s.unit_name].filter(Boolean).join(" ") : "Normal");
  const roleTag = (r) => r && el("span", `org-role org-role--${roleKey(r)}`, r);

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
  function unitPath(units, id) {
    const parts = [];
    for (let u = units.find((x) => x.id === id); u; u = units.find((x) => x.id === u.parent_id)) parts.unshift(u.name);
    return parts.join(" › ");
  }

  function memberFields() {
    return [
      { key: "name", label: "Full name", required: true },
      { key: "title", label: "Title", hint: "e.g. head of events" },
      { key: "telegram", label: "Telegram" },
      { key: "phone", label: "Phone (WhatsApp)", type: "tel" },
      { key: "email", label: "Email", type: "email" },
      { key: "dob", label: "Birthday", type: "date" },
      { key: "school", label: "School / organisation" },
      { key: "joined_on", label: "Joined Normal", type: "date" },
      { key: "round", label: "Recruitment round", hint: "e.g. August round" },
      { key: "status", label: "Status", type: "select", options: MEMBER_STATUSES, hint: "Leaning in / leaning no: recruits who haven't confirmed. Members see \"joining\"." },
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
      const status = select("Status", [["", "All statuses"], ...(isAdmin() ? MEMBER_STATUSES : ["active", "joining", "on break", "alumni"])]);
      status.id = "f-status";
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
        { label: "Role", cell: (m) => roleTag(m.org_role) },
        { label: "Seats", cell: (m) => m.seats.map(seatLabel).join(", ") },
        { label: "Telegram", cell: (m) => m.telegram && "@" + handleOf(m.telegram) },
        ...(isAdmin() ? [
          { label: "Phone", cell: (m) => m.phone },
          { label: "Round", cls: "is-muted", cell: (m) => m.round },
          { label: "Login", cell: (m) => m.login_role && pill(ROLE_NAMES[m.login_role], m.login_role) },
        ] : []),
        { label: "Status", cell: (m) => nodes(pill(m.status, statusKey(m.status)), Number(m.id) === me.memberId && pill("you", "you")) },
      ];
      loadRows = async () => {
        fail("");
        const [r] = await Promise.all([get("/api/admin/members?" + params({ q: q.value.trim(), unit: unit.value, status: status.value })), refreshUnits()]);
        if (!r) return;
        if (!r.ok) return fail(errText(r, "Couldn't load members."));
        fillList(columns, r.data.members, (m) => `#/m/${m.id}`, r.data.total,
          isAdmin() ? "No members yet. Add people, import the Team Map (Org chart → Import), or accept them from applications." : "No members yet.",
          "No members match those filters.",
          isAdmin() ? "" : "Contact details are visible to admins only.");
      };
    });
  }

  // where someone sits; admins can change it
  function seatsPanel(m, org, editable) {
    const list = el("ul", "db-seat-list");
    for (const s of m.seats) {
      const li = el("li");
      li.append(roleTag(s.role), el("span", "", s.unit_id ? unitPath(org.units, s.unit_id) : "Normal (the top)"));
      if (s.unit_code) li.append(el("span", "org-code", s.unit_code));
      if (s.note) li.append(el("span", "db-seat-note", s.note));
      list.append(li);
    }
    if (!m.seats.length) list.append(el("li", "db-note", "Not on the org chart."));
    if (!editable) return panel("seats", list);

    const rows = el("div", "db-seat-rows");
    const unitOpts = [["", "Normal (the top)"], ...unitOptions(org.units)];
    const addRow = (s = { unit_id: null, role: "Member", note: "" }) => {
      const row = el("div", "db-seat");
      const unit = select("Seat", unitOpts, s.unit_id ? String(s.unit_id) : "", "db-input seat-unit");
      const role = select("Role", ORG_ROLES, s.role || "Member", "db-input seat-role");
      const note = el("input", "db-input seat-note");
      note.type = "text";
      note.placeholder = "Seat note (admins only)";
      note.setAttribute("aria-label", "Seat note");
      note.value = s.note || "";
      const rm = button("Remove", "", () => row.remove());
      rm.classList.add("db-btn--sm");
      row.append(unit, role, note, rm);
      rows.append(row);
    };
    m.seats.forEach(addRow);
    const status = el("p", "db-error");
    const bar = el("div", "db-formbar");
    bar.append(
      button("Save seats", "primary", async () => {
        status.textContent = "";
        const seats = $$(".db-seat", rows).map((row) => ({ unit_id: $(".seat-unit", row).value || null, role: $(".seat-role", row).value, note: $(".seat-note", row).value }));
        const s = await api("/api/admin/members", { method: "PATCH", json: { id: m.id, seats } }).catch(() => null);
        if (!s || !s.ok) { status.textContent = errText(s); return; }
        toast("Seats saved.");
        memberProfile(String(m.id));
      }, "save-seats"),
      button("+ add seat", "", () => addRow(), "add-seat"),
    );
    return panel("seats", [list, el("p", "db-label db-seat-edit", "Change seats"), rows, status, bar]);
  }

  async function memberProfile(id) {
    fail("");
    if (id === "new") {
      const body = detail("#/members", "members", "new", "add member");
      const { form: f } = buildForm(memberFields(), { status: "active", joined_on: new Date().toISOString().slice(0, 10) }, {
        submit: "Save record",
        extra: [linkButton("Cancel", "#/members")],
        onSubmit: async (vals, status) => {
          const r = await api("/api/admin/members", { method: "POST", json: vals }).catch(() => null);
          if (!r || !r.ok) { status.textContent = errText(r); return; }
          toast("Member added. Give them a seat below.");
          location.hash = `#/m/${r.data.id}`;
        },
      });
      body.append(panel("member record", f));
      return;
    }

    const [r, org] = await Promise.all([get(`/api/admin/members?id=${encodeURIComponent(id)}`), getOrg()]);
    if (!r) return;
    if (!r.ok) {
      detail("#/members", "members", rid("M", id), "not found");
      return fail(r.status === 404 ? "That person isn't in the directory." : errText(r, "Couldn't load that profile."));
    }
    const { member: m, canEdit, canSeat } = r.data;
    const mine = Number(m.id) === me.memberId;
    const body = detail("#/members", "members", rid("M", m.id), m.name, [
      roleTag(m.org_role),
      m.title,
      pill(m.status, statusKey(m.status)),
      mine && pill("you", "you"),
    ]);
    const { main, aside } = recordLayout(body);

    main.append(seatsPanel(m, org || { units: [] }, canSeat));
    const tg = handleOf(m.telegram);
    main.append(panel("details", fields([
      ["Title", m.title || ""],
      ["Telegram", m.telegram ? "@" + tg : "", /^\w{3,}$/.test(tg) ? `https://t.me/${tg}` : null],
      ["WhatsApp", "phone" in m ? m.phone || "" : undefined, waOf(m.phone)],
      ["Email", "email" in m ? m.email || "" : undefined, m.email ? `mailto:${m.email}` : null],
      ["Birthday", "dob" in m ? day(m.dob) : undefined],
      ["School / org", "school" in m ? m.school || "" : undefined],
      ["Joined", "joined_on" in m ? day(m.joined_on) : undefined],
      ["Recruitment round", "round" in m ? m.round || "" : undefined],
    ])));
    if (isAdmin()) main.append(panel("notes", m.notes ? el("p", "db-notes", m.notes) : el("p", "db-note", "No notes.")));

    if (canEdit.length) {
      const { form: f } = buildForm(memberFields().filter((d) => canEdit.includes(d.key)), m, {
        submit: "Save changes",
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/members", { method: "PATCH", json: { id: m.id, ...vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          toast("Saved.");
          memberProfile(id);
        },
      });
      const editPanel = panel(mine && !isAdmin() ? "update your details" : "edit record", nodes(
        mine && !isAdmin() && el("p", "db-note", "Other members see your name, title, seats and Telegram. Only admins see the rest."),
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
      // Master Admins from ADMIN_USERS have no member record until they say which one is theirs
      if (me.fixed && me.memberId !== Number(m.id)) {
        acts.append(button("This is me", "", async () => {
          const s = await api("/api/admin/session", { method: "POST", json: { action: "link-member", memberId: m.id } }).catch(() => null);
          if (!s || !s.ok) return fail(errText(s));
          location.reload();
        }, "this-is-me"));
      }
      if (me.fixed && me.memberId === Number(m.id)) acts.append(el("p", "db-note", "This is you: your login is linked to this record."));
      acts.append(confirmButton("Delete record", "Their login (if any) stays, but loses its profile.", async () => {
        const d = await api(`/api/admin/members?id=${m.id}`, { method: "DELETE" }).catch(() => null);
        if (d && d.ok) { toast("Deleted."); location.hash = "#/members"; } else fail(errText(d));
      }));
      aside.append(panel("record", [meta]), panel("actions", acts));
      main.append(timelinePanel("member", m.id));
    } else {
      aside.append(panel("record", fields([["Record", rid("M", m.id)], ["Status", m.status]], true)));
    }
  }

  /* ───────────── the org chart ───────────── */
  function personChip(p, seat) {
    const role = seat ? seat.role : null;
    const a = el("a", `org-person org-person--${roleKey(role)} is-${statusKey(p.status)}${seat && seat.note ? " has-note" : ""}`);
    a.href = `#/m/${p.id}`;
    a.dataset.person = p.id;
    a.title = [p.name, role, p.status !== "active" ? p.status : "", seat && seat.note].filter(Boolean).join(" · ");
    a.append(el("span", "org-av", p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()), el("span", "org-nm", p.name));
    if (role) a.append(el("span", "org-rl", role));
    return a;
  }
  function chips(list, empty) {
    const box = el("div", "org-chips");
    if (list.length) box.append(...list.map(([p, s]) => personChip(p, s)));
    else if (empty) box.append(el("span", "org-empty", empty));
    return box;
  }

  async function orgChart() {
    fail("");
    show("org");
    // never show the last chart (possibly someone else's view of it) while this one loads
    $("#org-chart").replaceChildren(el("p", "db-empty", "Loading the org chart…"));
    $("#org-unplaced").hidden = true;
    $("#org-actions").replaceChildren(memberViews("chart"), ...(isAdmin() ? [linkButton("Import from Team Map", "#/org/import"), linkButton("+ add division", "#/org/new/division", "primary")] : []));
    const legend = ORG_ROLES.map((r) => {
      const s = el("span", `org-person org-person--${roleKey(r)} is-key`);
      s.append(el("span", "org-av"), el("span", "org-nm", r));
      return s;
    });
    const keyFor = (status, text) => {
      const s = el("span", `org-person org-person--member is-key is-${status}`);
      s.append(el("span", "org-av"), el("span", "org-nm", text));
      return s;
    };
    legend.push(el("span", "org-legend__gap"), ...(isAdmin() ? [keyFor("leaning-in", "leaning in"), keyFor("leaning-no", "leaning no")] : [keyFor("joining", "joining")]));
    if (isAdmin()) {
      const lab = el("label", "db-check org-legend__toggle");
      const box = el("input");
      box.type = "checkbox";
      box.id = "hide-leaning-no";
      box.addEventListener("change", () => $("#org-chart").classList.toggle("hide-leaning-no", box.checked));
      lab.append(box, "Hide leaning no");
      legend.push(lab);
    }
    $("#org-legend").replaceChildren(...legend);

    const org = await getOrg();
    if (!org) return fail("Couldn't load the org chart.");
    const { units, people, seats } = org;
    const person = new Map(people.map((p) => [p.id, p]));
    const kids = new Map();
    for (const u of units) {
      const k = u.parent_id ?? null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(u);
    }
    const seated = new Map(); // unit id (or null for the top) → [[person, seat]]
    for (const s of seats) {
      const p = person.get(s.member_id);
      if (!p) continue;
      if (!seated.has(s.unit_id)) seated.set(s.unit_id, []);
      seated.get(s.unit_id).push([p, s]);
    }
    const byRole = (a, b) => roleRank(a[1].role) - roleRank(b[1].role) || a[0].name.localeCompare(b[0].name);
    seated.forEach((l) => l.sort(byRole));
    const names = new Map(people.map((p) => [p.id, p.name]));

    const head = (u, label = u.kind) => {
      const h = el("div", "org-unit__head");
      if (u.code) h.append(el("span", "org-code", u.code));
      if (isAdmin()) {
        const a = el("a", "org-name", u.name);
        a.href = `#/org/${u.id}`;
        h.append(a);
      } else {
        h.append(el("span", "org-name", u.name));
      }
      h.append(el("span", "org-kind", label));
      return h;
    };
    const addLink = (text, href) => {
      const a = el("a", "org-add", text);
      a.href = href;
      return a;
    };
    function unitNode(u) {
      let children = kids.get(u.id) || [];
      let here = seated.get(u.id) || [];
      let shown = u;
      // a domain that is just one team of the same name shows as one card
      const only = children.length === 1 ? children[0] : null;
      const merged = u.kind === "domain" && only && only.kind === "team" && !here.length && !(kids.get(only.id) || []).length
        && only.name.toLowerCase() === u.name.toLowerCase();
      if (merged) {
        shown = { ...only, code: only.code || u.code };
        here = seated.get(only.id) || [];
        children = [];
      }
      const box = el("div", `org-unit org-unit--${merged ? "team" : u.kind}${merged ? " is-merged" : ""}`);
      box.dataset.unit = u.id;
      if (u.overseers.length) box.dataset.overseers = u.overseers.join(" ");
      const bodyEl = el("div", "org-unit__body");
      if (u.kind === "domain" && u.overseers.length) {
        bodyEl.append(el("p", "org-over", `Overseen by ${u.overseers.map((id) => names.get(id)).filter(Boolean).join(", ")}`));
      }
      if (here.length || shown.kind === "team" || !children.length) bodyEl.append(chips(here, "No one yet"));
      if (children.length) {
        const list = el("div", "org-kids");
        list.append(...children.map(unitNode));
        bodyEl.append(list);
      }
      if (isAdmin() && shown.kind !== "team") {
        const adds = el("div", "org-adds");
        if (u.kind === "division") adds.append(addLink("+ domain", `#/org/new/domain/${u.id}`));
        adds.append(addLink("+ team", `#/org/new/team/${u.id}`));
        bodyEl.append(adds);
      }
      box.append(head(shown, merged ? "domain · team" : shown.kind), bodyEl);
      return box;
    }

    const chart = $("#org-chart");
    const top = el("div", "org-top");
    const topCard = el("div", "org-unit org-unit--root");
    const topHead = el("div", "org-unit__head");
    topHead.append(el("span", "org-name", "Normal"), el("span", "org-kind", "the top"));
    topCard.append(topHead);
    const atTop = seated.get(null) || [];
    if (atTop.length) {
      const topBody = el("div", "org-unit__body");
      topBody.append(chips(atTop));
      topCard.append(topBody);
    }
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
      chart.replaceChildren(top, el("p", "db-empty", isAdmin() ? "No divisions yet. Import the Team Map, or add a division to start." : "The org chart hasn't been set up yet."));
    }
    chart.classList.toggle("hide-leaning-no", Boolean($("#hide-leaning-no") && $("#hide-leaning-no").checked));
    // wider than the screen: start the tree at the left, where the view opens, instead of centring it
    chart.classList.remove("is-wide");
    requestAnimationFrame(() => chart.classList.toggle("is-wide", chart.offsetWidth > chart.parentElement.clientWidth + 1));

    // hover a director to light up what they oversee
    chart.querySelectorAll(".org-person[data-person]").forEach((chip) => {
      const lit = () => chart.querySelectorAll(".org-unit[data-overseers]").forEach((u) => u.classList.toggle("is-lit", u.dataset.overseers.split(" ").includes(chip.dataset.person)));
      const off = () => chart.querySelectorAll(".is-lit").forEach((u) => u.classList.remove("is-lit"));
      chip.addEventListener("mouseenter", lit);
      chip.addEventListener("focus", lit);
      chip.addEventListener("mouseleave", off);
      chip.addEventListener("blur", off);
    });

    const onChart = new Set(seats.filter((s) => person.has(s.member_id)).map((s) => s.member_id));
    const unplaced = people.filter((p) => !onChart.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
    const count = (k) => { const n = units.filter((u) => u.kind === k).length; return `${n} ${k}${n === 1 ? "" : "s"}`; };
    const leaning = people.filter((p) => onChart.has(p.id) && /^(leaning|joining)/.test(p.status)).length;
    $("#org-count").textContent = `${onChart.size} ${onChart.size === 1 ? "person" : "people"} on the chart${leaning ? ` (${leaning} not confirmed yet)` : ""} · ${count("division")} · ${count("domain")} · ${count("team")}`;
    $("#org-note").textContent = isAdmin() ? "Change someone's seats on their member record." : "";
    $("#org-unplaced").hidden = !unplaced.length;
    $("#org-unplaced-note").textContent = isAdmin() ? "Open someone and give them a seat." : "";
    $("#org-unplaced-list").replaceChildren(...unplaced.map((p) => personChip(p, null)));
  }

  async function unitForm(id, kindArg, parentArg) {
    fail("");
    const org = await getOrg();
    if (!org) return fail("Couldn't load the org chart.");
    const isNew = id === "new";
    const unit = isNew ? { kind: kindArg, parent_id: parentArg ? Number(parentArg) : null, overseers: [] } : org.units.find((u) => String(u.id) === id);
    const kind = unit ? unit.kind : kindArg;
    const body = detail("#/members/chart", "org chart", isNew ? "new" : unit ? unit.code || `#${unit.id}` : "", isNew ? `add ${kind}` : unit ? unit.name : "not found", unit && !isNew ? [el("span", "db-pill", kind), unit.parent_id ? unitPath(org.units, unit.parent_id) : ""] : []);
    if (!unit) return fail("That part of the org chart isn't there any more.");

    const defs = [
      { key: "name", label: "Name", required: true },
      { key: "code", label: "Code", hint: "Short reference, e.g. PB or PB.1" },
    ];
    if (kind !== "division") {
      const allowed = PARENT_KINDS[kind];
      defs.push({ key: "parent_id", label: kind === "domain" ? "Division" : "Sits under", type: "select", options: unitOptions(org.units, (u) => allowed.includes(u.kind)) });
    }
    if (kind === "domain") {
      const leads = new Set(org.seats.filter((s) => OVERSEER_ROLES.includes(s.role)).map((s) => s.member_id));
      const eligible = org.people.filter((p) => leads.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
      defs.push({ key: "overseers", label: "Overseen by", type: "checks", wide: true, options: eligible.map((p) => [String(p.id), p.name]),
        hint: eligible.length ? "Founders, Chiefs of Staff and Directors." : "Give someone a Director seat to pick them here." });
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
    const person = new Map(org.people.map((p) => [p.id, p]));
    const here = org.seats.filter((s) => s.unit_id === unit.id && person.has(s.member_id)).map((s) => [person.get(s.member_id), s]);
    aside.append(panel("seated here", here.length ? chips(here) : el("p", "db-note", "No one is seated here. Give someone a seat on their member record.")));
    main.append(timelinePanel("unit", unit.id));
  }

  /* ───────────── importing the Team Map ───────────── */
  function importPage() {
    fail("");
    const body = detail("#/members/chart", "org chart", "import", "import from Team Map");
    const intro = el("p", "db-note", "In the Team Map, use Export CSV, then choose that file here (or paste it). People are matched by name and units by name: anything new is added. Everyone in the file then gets the file's seats, status and round. Nobody is deleted.");
    const file = el("input");
    file.type = "file";
    file.accept = ".csv,text/csv";
    file.id = "imp-file";
    const fileLab = el("label", "db-label", "Team Map export (.csv)");
    fileLab.htmlFor = "imp-file";
    const text = el("textarea", "db-input mono");
    text.id = "imp-text";
    text.rows = 4;
    text.placeholder = "…or paste the CSV here";
    text.setAttribute("aria-label", "Paste the CSV");
    const check = button("Check file", "primary", () => run(text.value), "imp-check");
    const out = el("div", "db-import-out");
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (f) { text.value = await f.text(); run(text.value); }
    });
    const pick = el("div", "db-stack");
    pick.append(intro, fileLab, file, text, el("div", "db-actions"));
    $(".db-actions", pick).append(check);
    body.append(panel("1. the file", pick));
    body.append(out);

    function run(csv) {
      fail("");
      const plan = window.NormalTeamMap.parse(csv);
      if (plan.error) { out.replaceChildren(); return fail(plan.error); }
      const s = plan.summary;
      const facts = fields([
        ["Divisions", String(s.divisions)], ["Domains", String(s.domains)], ["Teams", String(s.teams)],
        ["People", String(s.people)], ["Seats", String(s.seats)], ["With two or more seats", String(s.twoSeats)],
        ["Leaning in / no", String(s.leaning)], ["Left the team", String(s.left)],
      ]);
      const warn = plan.warnings.length ? el("ul", "db-warnings") : null;
      if (warn) plan.warnings.forEach((w) => warn.append(el("li", "", w)));
      const thead = el("thead"), tbody = el("tbody");
      renderTable(thead, tbody, [
        { label: "Name", cls: "is-name", cell: (p) => p.name },
        { label: "Status", cell: (p) => pill(p.status, statusKey(p.status)) },
        { label: "Seats", cell: (p) => p.seats.map((x) => `${x.role} · ${x.unit ? x.unit : "Normal"}`).join("  |  ") },
        { label: "Round", cls: "is-muted", cell: (p) => p.round },
        { label: "Note", cls: "is-muted", cell: (p) => [p.note, ...p.seats.map((x) => x.note)].filter(Boolean).join("; ") },
      ], plan.people);
      const table = el("table", "db-table");
      table.append(thead, tbody);
      const scroll = el("div", "db-scroll db-scroll--tall");
      scroll.append(table);
      const go = button(`Import ${s.people} people`, "primary", async () => {
        go.disabled = true;
        const r = await api("/api/admin/org", { method: "POST", json: { action: "import", units: plan.units, people: plan.people } }).catch(() => null);
        go.disabled = false;
        if (!r || !r.ok) return fail(errText(r, "Couldn't import that. Nothing was changed."));
        const d = r.data;
        toast(`Imported: ${d.peopleAdded} people added, ${d.peopleUpdated} updated, ${d.unitsAdded} divisions/domains/teams added.`);
        listKey = null;
        location.hash = "#/members/chart";
      }, "imp-go");
      out.replaceChildren(
        panel("2. what's in it", nodes(facts, warn)),
        (() => { const p = panel("3. check the people", null); p.append(scroll); return p; })(),
        panel(null, el("div", "db-actions")),
      );
      $(".db-actions", out.lastChild).append(go, linkButton("Cancel", "#/members/chart"));
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
    if (me.role === "master") {
      review.append(confirmButton("Delete application", "Deletes it and its notes for good (privacy requests).", async () => {
        const s = await api(`/api/admin/applications?id=${a.id}`, { method: "DELETE" }).catch(() => null);
        if (!s || !s.ok) return fail(errText(s));
        listKey = null;
        toast("Application deleted.");
        location.hash = "#/applications";
      }));
    }
    main.append(timelinePanel("application", a.id));
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
    main.append(timelinePanel("account", a.id));
  }

  /* ───────────── the suite: modules from lib/collections.js ───────────── */
  let schema = {}; // the modules this person can open, with their fields and rules
  const money = (n) => `S$${Number(n || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const todaySG = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const firstName = (n) => String(n || "").split(/\s+/)[0];

  const ICONS = {
    home: '<path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5z"/>',
    members: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c.6-2.4 2.3-3.5 4.5-3.5s3.9 1.1 4.5 3.5"/><path d="M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12.2 10.3c1.2.5 2 1.6 2.3 3.2"/>',
    applications: '<rect x="2.5" y="1.5" width="11" height="13" rx="1.5"/><path d="M5 5h6M5 8h6M5 11h3.5"/>',
    check: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="m5.5 8 2 2 3.5-4"/>',
    flag: '<path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8"/>',
    chat: '<path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5H7l-3 2.5v-2.5A1.5 1.5 0 0 1 2.5 9z"/>',
    handshake: '<circle cx="5.5" cy="8" r="3"/><circle cx="10.5" cy="8" r="3"/>',
    coin: '<circle cx="8" cy="8" r="5.5"/><path d="M9.8 6.2c-.3-.6-1-.9-1.8-.9-1 0-1.8.5-1.8 1.3 0 1.8 3.7.9 3.7 2.7 0 .8-.8 1.4-1.9 1.4-.9 0-1.6-.4-1.9-1M8 4v1.3M8 10.7V12"/>',
    book: '<path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z"/><path d="M3 11.5a2 2 0 0 1 2-2h7.5"/>',
    megaphone: '<path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 6a2.5 2.5 0 0 1 0 4M4.5 9.5l1 4"/>',
    globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.6 2.4 3.4 2.4 5.5S9.6 11.9 8 13.5C6.4 11.9 5.6 10.1 5.6 8S6.4 4.1 8 2.5z"/>',
    key: '<circle cx="5" cy="10.5" r="3"/><path d="M7.2 8.4 13.5 2M11 4.5l2 2M9.5 6l1.5 1.5"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5"/>',
    shield: '<path d="M8 1.8 13 3.5v4c0 3-2.1 5.3-5 6.7-2.9-1.4-5-3.7-5-6.7v-4z"/>',
  };
  // the icons are fixed strings above, never anything people typed
  function icon(name) {
    const t = document.createElement("template");
    t.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.check}</svg>`;
    return t.content.firstChild;
  }

  // the sidebar: home, then each group's sections the person can open
  function buildNav() {
    const nav = $("#tabs");
    nav.replaceChildren();
    const add = (tab, label, href, ic) => {
      const a = el("a");
      a.href = href;
      a.dataset.tab = tab;
      a.append(icon(ic), label);
      nav.append(a);
    };
    add("home", "home", "#/", "home");
    for (const g of ["People", "Work", "Outreach", "Money", "Library", "Website", "Admin"]) {
      const items = [];
      if (g === "People") {
        items.push(["members", "members", "#/members", "members"]);
        if (isAdmin()) items.push(["applications", "applications", "#/applications", "applications"]);
      }
      for (const c of Object.values(schema)) if (c.group === g) items.push([c.key, c.label, `#/r/${c.key}`, c.icon]);
      if (g === "Website" && isAdmin()) items.push(["whats-on", "what's on", "#/whats-on", "globe"]);
      if (g === "Admin") {
        if (me.role === "master") items.push(["accounts", "accounts", "#/accounts", "key"]);
        if (isAdmin()) items.push(["activity", "activity log", "#/activity", "history"]);
        if (me.role === "master") items.push(["privacy", "privacy", "#/privacy", "shield"]);
      }
      if (!items.length) continue;
      nav.append(el("p", "db-side__label", g));
      items.forEach((i) => add(...i));
    }
  }

  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#search-q").value.trim();
    if (text) location.hash = `#/search/${encodeURIComponent(text)}`;
  });
  addEventListener("keydown", (e) => {
    if (e.key === "/" && me && !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#search-q").focus();
    }
  });

  // names for people, units and linked records, for menus
  async function lookups(c) {
    const cfg = schema[c];
    const out = { people: [], units: [], links: {} };
    if (cfg.fields.some((f) => ["member", "members", "unit"].includes(f.type))) {
      const org = await getOrg();
      if (org) { out.people = org.people; out.units = org.units; }
    }
    for (const f of cfg.fields.filter((x) => x.type === "link" && schema[x.to])) {
      const r = await get(`/api/admin/records?c=${f.to}&lite=1`);
      out.links[f.to] = r && r.ok ? r.data.records : [];
    }
    return out;
  }
  const peopleOptions = (look) => look.people.map((p) => [String(p.id), p.name]);
  const linkOptions = (look, to) => (look.links[to] || []).map((r) => [String(r.id), `${r.code} ${r.title}`]);
  const isDone = (cfg, data) => Boolean(cfg.done && cfg.done.values.includes(data[cfg.done.field]));

  // a stored value as people read it; inTable keeps it short
  function fmtValue(cfg, f, v, refs, data, inTable) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "";
    const link = (text, href, external) => {
      const a = el("a", "", text);
      a.href = href;
      if (external) { a.target = "_blank"; a.rel = "noopener"; }
      return a;
    };
    switch (f.type) {
      case "select": return pill(v, v);
      case "check": return v ? "✓ yes" : "";
      case "date": {
        const late = f.key === cfg.due && !isDone(cfg, data) && v < todaySG() && cfg.key === "tasks";
        return el("span", late ? "is-overdue" : "", day(v) + (late ? " · overdue" : ""));
      }
      case "money": return money(v);
      case "number": return String(v);
      case "url": { let host = v; try { host = new URL(v).hostname.replace(/^www\./, ""); } catch { /* keep it */ } return link(inTable ? `${host} ↗` : v, v, true); }
      case "email": return link(v, `mailto:${v}`);
      case "member": return refs.members[v] ? link(refs.members[v], `#/m/${v}`) : "former member";
      case "members": {
        const names = v.map((x) => refs.members[x] || "former member");
        if (inTable) return names.join(", ");
        const box = el("span", "db-names");
        v.forEach((x, i) => box.append(refs.members[x] ? link(names[i], `#/m/${x}`) : names[i], i < v.length - 1 ? ", " : ""));
        return box;
      }
      case "unit": return refs.units[v] || "(removed)";
      case "link": { const t = (refs.links[f.to] || {})[v]; return t ? link(t, `#/r/${f.to}/${v}`) : "(removed)"; }
      case "long": return inTable ? String(v).slice(0, 80) + (String(v).length > 80 ? "…" : "") : el("p", "db-notes", v);
      default: return String(v);
    }
  }

  // a module field as a form question
  function formDef(f, look) {
    const base = { key: f.key, label: f.label + (f.type === "money" ? " (S$)" : ""), required: f.required, hint: f.hint, wide: f.wide || f.type === "members" };
    switch (f.type) {
      case "long": return { ...base, type: "textarea" };
      case "select": return { ...base, type: "select", options: f.required ? f.options : [["", "—"], ...f.options] };
      case "check": return { ...base, type: "checkbox" };
      case "number": return { ...base, type: "number" };
      case "money": return { ...base, type: "number", step: "0.01" };
      case "phone": return { ...base, type: "tel" };
      case "member": return { ...base, type: "select", options: [["", "—"], ...peopleOptions(look)] };
      case "members": return { ...base, type: "checks", options: peopleOptions(look) };
      case "unit": return { ...base, type: "select", options: [["", "—"], ...unitOptions(look.units)] };
      case "link": return { ...base, type: "select", options: [["", "—"], ...linkOptions(look, f.to)] };
      default: return { ...base, type: f.type };
    }
  }
  function formValues(fieldsList, data) {
    const out = {};
    for (const f of fieldsList) {
      const v = data[f.key];
      if (f.type === "members") out[f.key] = (v || []).map(String);
      else if (f.type === "check") out[f.key] = Boolean(v);
      else if (v !== undefined && v !== null) out[f.key] = ["member", "unit", "link"].includes(f.type) ? String(v) : v;
    }
    return out;
  }

  /* lists */
  function collectionList(c) {
    const cfg = schema[c];
    openList(`c:${c}`, () => {
      $("#list-title").textContent = cfg.label;
      const q = searchBox(`Search ${cfg.label}…`);
      q.id = "f-q";
      const scopeOpts = [["", "All records"], ["mine", "Mine"]];
      if (cfg.done) scopeOpts.push(["open", "Not done"]);
      if (cfg.admin) scopeOpts.push(["archived", "Archived"]);
      const scope = select("Show", scopeOpts);
      scope.id = "f-scope";
      const filterFields = cfg.fields.filter((f) => f.filter);
      const filterEls = filterFields.map((f) => {
        const s = select(f.label, [["", `All ${f.label.toLowerCase()}`], ...(f.type === "select" ? f.options : [])]);
        s.id = `f-${f.key}`;
        return s;
      });
      filterInputs([q, scope, ...filterEls]);
      lookups(c).then((look) => filterFields.forEach((f, i) => {
        if (f.type === "select") return;
        const opts = f.type === "unit" ? unitOptions(look.units) : f.type === "link" ? linkOptions(look, f.to) : peopleOptions(look);
        const keep = filterEls[i].value;
        filterEls[i].append(...opts.map(([v, t]) => new Option(t, v)));
        filterEls[i].value = keep;
      }));
      if (cfg.admin) $("#list-actions").append(button("Export CSV", "", () => download(`/api/admin/records?${params({ c, format: "csv", q: q.value.trim() })}`)));
      if (cfg.canCreate) $("#list-actions").append(linkButton(`+ new ${cfg.noun}`, `#/r/${c}/new`, "primary"));

      const listed = cfg.fields.filter((f) => f.list);
      let refs = { members: {}, units: {}, links: {} };
      const columns = [
        { label: "ID", cls: "is-id", cell: (r) => r.code },
        ...listed.map((f) => ({
          label: f.label,
          cls: f.key === cfg.title ? "is-name" : f.type === "money" ? "is-right" : "",
          link: f.key === cfg.title,
          cell: (r) => (f.key === cfg.title ? r.data[f.key] || "(untitled)" : fmtValue(cfg, f, r.data[f.key], refs, r.data, true)),
        })),
      ];
      loadRows = async () => {
        fail("");
        const query = { c, q: q.value.trim() };
        if (scope.value === "mine") query.mine = "1";
        if (scope.value === "open") query.open = "1";
        if (scope.value === "archived") query.archived = "1";
        filterFields.forEach((f, i) => { if (filterEls[i].value) query[`f.${f.key}`] = filterEls[i].value; });
        const r = await get(`/api/admin/records?${params(query)}`);
        if (!r) return;
        if (!r.ok) return fail(errText(r, `Couldn't load ${cfg.label}.`));
        refs = r.data.refs;
        let note = "";
        if (cfg.totals) {
          const sums = {};
          for (const rec of r.data.records) {
            if (rec.data.status === "rejected") continue;
            const k = rec.data[cfg.totals.by] || "other";
            sums[k] = (sums[k] || 0) + Number(rec.data[cfg.totals.amount] || 0);
          }
          note = Object.entries(sums).map(([k, v]) => `${k} ${money(v)}`).join(" · ");
        }
        fillList(columns, r.data.records, (rec) => `#/r/${c}/${rec.id}`, r.data.total,
          cfg.canCreate ? `No ${cfg.label} yet. Add the first with "+ new ${cfg.noun}".` : `No ${cfg.label} to show yet.`,
          `No ${cfg.label} match those filters.`, note);
      };
    });
  }

  /* one record */
  async function recordPage(c, id) {
    const cfg = schema[c];
    fail("");
    const look = await lookups(c);
    if (id === "new") {
      const body = detail(`#/r/${c}`, cfg.label, "new", `new ${cfg.noun}`);
      if (!cfg.canCreate) return fail(ERRORS.not_allowed);
      const defs = cfg.fields.filter((f) => cfg.createFields.includes(f.key)).map((f) => formDef(f, look));
      const { form: f } = buildForm(defs, formValues(cfg.fields, cfg.defaults), {
        submit: `Save ${cfg.noun}`,
        extra: [linkButton("Cancel", `#/r/${c}`)],
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/records", { method: "POST", json: { c, data: vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          listKey = null;
          toast(`${s.data.record.code} saved.`);
          location.hash = `#/r/${c}/${s.data.record.id}`;
        },
      });
      if (!cfg.admin && cfg.seeAll === false) f.prepend(el("p", "db-note db-field--wide", "You'll be added to it, so you can find it later."));
      body.append(panel(`${cfg.noun} record`, f));
      return;
    }

    const r = await get(`/api/admin/records?c=${c}&id=${encodeURIComponent(id)}`);
    if (!r) return;
    if (!r.ok) { detail(`#/r/${c}`, cfg.label, "", "not found"); return fail(r.status === 404 ? "That record isn't there, or you don't have access to it." : errText(r)); }
    const { record: rec, refs, canEdit, canManage } = r.data;
    const statusField = cfg.fields.find((f) => f.key === "status") || cfg.fields.find((f) => f.type === "select" && f.list);
    const body = detail(`#/r/${c}`, cfg.label, rec.code, rec.data[cfg.title] || "(untitled)", [
      statusField && rec.data[statusField.key] && pill(rec.data[statusField.key], rec.data[statusField.key]),
      rec.archived && pill("archived", "disabled"),
    ]);
    const { main, aside } = recordLayout(body);
    // people who can change every field just get the form; everyone else sees the record, then what they can change
    const editsAll = cfg.fields.every((f) => canEdit.includes(f.key));
    if (!editsAll) {
      main.append(panel("details", fields(cfg.fields.filter((f) => f.key !== cfg.title).map((f) => {
        const v = fmtValue(cfg, f, rec.data[f.key], refs, rec.data, false);
        return [f.label, v === "" ? "" : v];
      }))));
    }
    const related = el("div", "db-related");

    // records in other modules that point at this one (an event's tasks, budget and meetings)
    for (const other of Object.values(schema)) {
      const via = other.fields.find((f) => f.type === "link" && f.to === c);
      if (!via) continue;
      const rr = await get(`/api/admin/records?${params({ c: other.key, [`f.${via.key}`]: String(rec.id) })}`);
      if (!rr || !rr.ok || !rr.data.records.length) continue;
      const ul = el("ul", "db-mini");
      for (const x of rr.data.records.slice(0, 8)) {
        const li = el("li");
        const a = el("a", "", x.data[other.title] || "(untitled)");
        a.href = `#/r/${other.key}/${x.id}`;
        const st = other.fields.find((f) => f.type === "select" && f.list);
        li.append(el("span", "mono muted", x.code), a, ...(st && x.data[st.key] ? [pill(x.data[st.key], x.data[st.key])] : []),
          ...(other.totals ? [el("span", "muted", money(x.data[other.totals.amount]))] : []));
        ul.append(li);
      }
      const more = linkButton(`All ${rr.data.records.length} →`, `#/r/${other.key}`);
      more.classList.add("db-btn--sm");
      related.append(panel(`${other.label} (${rr.data.records.length})`, ul, rr.data.records.length > 8 ? more : null));
    }

    if (canEdit.length) {
      const editable = cfg.fields.filter((f) => canEdit.includes(f.key));
      const { form: f } = buildForm(editable.map((x) => formDef(x, look)), formValues(editable, rec.data), {
        submit: "Save changes",
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/records", { method: "PATCH", json: { c, id: rec.id, data: vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          listKey = null;
          toast("Saved.");
          recordPage(c, String(rec.id));
        },
      });
      main.append(panel(editsAll ? "details" : "update", f));
    }
    main.append(related, timelinePanel(`record:${c}`, rec.id));

    aside.append(panel("record", fields([
      ["Record", rec.code],
      ["Created", `${when(rec.created_at)}${rec.created_by ? ` by ${rec.created_by}` : ""}`],
      ["Last changed", `${when(rec.updated_at)}${rec.updated_by ? ` by ${rec.updated_by}` : ""}`],
    ], true)));
    if (canManage) {
      const acts = el("div", "db-stack");
      acts.append(button(rec.archived ? "Restore" : "Archive", "", async () => {
        const s = await api("/api/admin/records", { method: "PATCH", json: { c, id: rec.id, archived: !rec.archived } }).catch(() => null);
        if (!s || !s.ok) return fail(errText(s));
        listKey = null;
        toast(rec.archived ? "Restored." : "Archived. Find it under Show → Archived.");
        recordPage(c, String(rec.id));
      }, "archive-record"));
      acts.append(confirmButton("Delete for good", "This can't be undone. Archive keeps it out of the way instead.", async () => {
        const s = await api(`/api/admin/records?c=${c}&id=${rec.id}`, { method: "DELETE" }).catch(() => null);
        if (!s || !s.ok) return fail(errText(s));
        listKey = null;
        toast("Deleted.");
        location.hash = `#/r/${c}`;
      }));
      aside.append(panel("actions", acts));
    }
  }

  /* history and notes, on any record */
  const ACTION_TEXT = { created: "created this", updated: "changed", note: "left a note", archived: "archived this", restored: "restored this", deleted: "deleted", accepted: "accepted this application", imported: "imported", "made a setup link": "made a setup link", "signed in": "signed in" };
  function timelinePanel(kind, ref) {
    const p = el("section", "db-panel db-timeline");
    const head = el("div", "db-panel__head");
    head.append(el("h2", "", "history & notes"));
    const bodyEl = el("div", "db-panel__body");
    const text = el("textarea", "db-input");
    text.id = "note-text";
    text.rows = 2;
    text.placeholder = "Add a note: a call, a decision, an update…";
    text.setAttribute("aria-label", "Note");
    const list = el("ol", "db-tl");
    const add = button("Add note", "primary", async () => {
      if (!text.value.trim()) return;
      add.disabled = true;
      const s = await api("/api/admin/home", { method: "POST", json: { action: "note", kind, ref, text: text.value } }).catch(() => null);
      add.disabled = false;
      if (!s || !s.ok) return fail(errText(s));
      text.value = "";
      load();
    }, "note-add");
    add.classList.add("db-btn--sm");
    const composer = el("div", "db-composer");
    composer.append(text, add);
    bodyEl.append(composer, list);
    p.append(head, bodyEl);
    async function load() {
      const r = await get(`/api/admin/home?${params({ view: "activity", kind, ref: String(ref) })}`);
      if (!r || !r.ok) { list.replaceChildren(el("li", "db-note", "Couldn't load the history.")); return; }
      list.replaceChildren(...r.data.entries.map((e) => entryNode(e, true, load)));
      if (!r.data.entries.length) list.append(el("li", "db-note", "Nothing yet."));
    }
    load();
    return p;
  }
  function entryNode(e, inTimeline, reload) {
    const li = el("li", `db-tl__item${e.action === "note" ? " is-note" : ""}`);
    const who = e.actor_name || e.actor || "someone";
    const head = el("p", "db-tl__head");
    head.append(el("span", "db-avatar db-avatar--sm", who.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()), el("strong", "", who), ` ${ACTION_TEXT[e.action] || e.action}`);
    if (!inTimeline && e.label) {
      head.append(" ");
      if (e.href) { const a = el("a", "", e.label); a.href = e.href; head.append(a); } else head.append(el("span", "", e.label));
    }
    head.append(el("span", "db-tl__when", when(e.at)));
    li.append(head);
    if (e.changes && e.changes.length) {
      const ul = el("ul", "db-tl__changes");
      for (const ch of e.changes) {
        const c = el("li");
        c.append(el("span", "db-tl__field", ch.field), ch.from !== null && ch.from !== undefined ? `${ch.from} → ` : "", ch.to === null || ch.to === undefined ? "(cleared)" : ch.to);
        ul.append(c);
      }
      li.append(ul);
    }
    if (e.note) li.append(el("p", "db-notes db-tl__note", e.note));
    if (e.action === "note" && (e.mine || isAdmin()) && reload) {
      const del = el("button", "db-link", "delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        const s = await api(`/api/admin/home?note=${e.id}`, { method: "DELETE" }).catch(() => null);
        if (s && s.ok) reload(); else fail(errText(s));
      });
      li.append(del);
    }
    return li;
  }

  /* home */
  function miniList(items, render, empty) {
    const ul = el("ul", "db-mini");
    for (const x of items) ul.append(render(x));
    if (!items.length) ul.append(el("li", "db-note", empty));
    return ul;
  }
  const recLi = (c, extra) => (x) => {
    const li = el("li");
    const a = el("a", "", x.title);
    a.href = `#/r/${c}/${x.id}`;
    li.append(a, ...nodes(extra ? extra(x) : []));
    return li;
  };
  async function homePage() {
    fail("");
    show("home");
    const hour = Number(new Date().toLocaleString("en-SG", { hour: "numeric", hour12: false, timeZone: "Asia/Singapore" }));
    $("#home-title").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${firstName(me.name)}`;
    $("#home-sub").textContent = new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Singapore" });
    const bodyEl = $("#home-body");
    bodyEl.replaceChildren(el("p", "db-note", "Loading…"));
    const r = await get("/api/admin/home?view=dashboard");
    if (!r) return;
    if (!r.ok) { bodyEl.replaceChildren(); return fail(errText(r, "Couldn't load home.")); }
    const d = r.data;
    const parts = [];

    if (d.counts) {
      const k = d.counts;
      const stat = (n, label, href, sub, warn) => {
        const a = el("a", `db-stat${warn ? " is-warn" : ""}`);
        a.href = href;
        a.append(el("span", "db-stat__n", String(n)), el("span", "db-stat__l", label));
        if (sub) a.append(el("span", "db-stat__s", sub));
        return a;
      };
      const grid = el("div", "db-stats");
      grid.append(
        stat(k.members, "active members", "#/members", k.joining ? `+${k.joining} recruits not confirmed` : ""),
        stat(k.newApplications, "new applications", "#/applications", "", k.newApplications > 0),
        stat(k.openTasks, "open tasks", "#/r/tasks", k.overdueTasks ? `${k.overdueTasks} overdue` : "", k.overdueTasks > 0),
        stat(k.upcoming, "events & projects ahead", "#/r/projects"),
        stat(k.claims.n, "claims to approve", "#/r/finance", k.claims.n ? money(k.claims.total) : "", k.claims.n > 0),
        stat(k.activePartners, "active partners", "#/r/partners"),
        ...(k.pendingLinks !== undefined ? [stat(k.pendingLinks, "setup links unused", "#/accounts")] : []),
      );
      parts.push(grid);
    }

    const left = el("div", "db-home__col");
    const right = el("div", "db-home__col");
    const due = (x) => (x.data.due ? [el("span", x.data.due < d.today ? "is-overdue" : "muted", day(x.data.due))] : []);
    if (d.counts) {
      left.append(
        panel("new applications", miniList(d.applications, (a) => {
          const li = el("li");
          const link = el("a", "", a.name);
          link.href = `#/a/${a.id}`;
          li.append(link, el("span", "muted", [a.life_stage, when(a.created_at)].filter(Boolean).join(" · ")));
          return li;
        }, "None waiting."), linkButton("All →", "#/applications")),
        panel("overdue tasks", miniList(d.overdue, recLi("tasks", (x) => [el("span", "muted", x.names.assignees || "unassigned"), ...due(x)]), "Nothing overdue.")),
        panel("claims to approve", miniList(d.claimsToApprove, recLi("finance", (x) => [el("span", "muted", x.names.claimant || ""), el("span", "", money(x.data.amount))]), "None waiting.")),
      );
    }
    left.append(
      panel("my tasks", miniList(d.myTasks, recLi("tasks", (x) => [pill(x.data.status, x.data.status), ...due(x)]), "Nothing assigned to you."), schema.tasks && schema.tasks.canCreate ? linkButton("+ task", "#/r/tasks/new") : null),
      panel("my meetings", miniList(d.myMeetings, recLi("meetings", (x) => [el("span", "muted", day(x.data.date))]), "No meetings coming up.")),
    );
    if (d.myClaims) {
      left.append(panel("my claims", miniList(d.myClaims, recLi("finance", (x) => [pill(x.data.status, x.data.status), el("span", "", money(x.data.amount))]), "No claims."),
        schema.finance && schema.finance.canCreate ? linkButton("+ submit a claim", "#/r/finance/new") : null));
    }
    right.append(
      panel("coming up", miniList(d.upcoming, recLi("projects", (x) => [el("span", "muted", [day(x.data.start), x.names.team].filter(Boolean).join(" · ")), pill(x.data.status, x.data.status)]), "Nothing scheduled.")),
      panel("announcements", miniList(d.announcements, (x) => {
        const li = el("li", "db-mini__block");
        const a = el("a", "", (x.data.pinned ? "📌 " : "") + x.title);
        a.href = `#/r/announcements/${x.id}`;
        li.append(a, el("span", "muted", day(x.data.date)), el("p", "db-notes", String(x.data.body || "").slice(0, 220)));
        return li;
      }, "No announcements.")),
    );
    if (d.mySeats) {
      right.append(panel("where you sit", miniList(d.mySeats, (s) => {
        const li = el("li");
        li.append(roleTag(s.role), el("span", "", s.name ? [s.code, s.name].filter(Boolean).join(" ") : "Normal"));
        return li;
      }, "You're not on the org chart yet."), linkButton("Org chart →", "#/members/chart")));
    }
    if (d.recent) right.append(panel("recent activity", miniList(d.recent, (e) => entryNode(e, false, null), "Nothing yet."), linkButton("Full log →", "#/activity")));
    const cols = el("div", "db-home");
    cols.append(left, right);
    parts.push(cols);
    bodyEl.replaceChildren(...parts);
  }

  /* search */
  async function searchPage(text) {
    fail("");
    $("#search-q").value = text;
    const bodyEl = detail("#/", "home", "search", `“${text}”`);
    const r = await get(`/api/admin/home?${params({ view: "search", q: text })}`);
    if (!r || !r.ok) return fail(errText(r, "Couldn't search just now."));
    if (!r.data.groups.length) { bodyEl.append(el("p", "db-empty", text.length < 2 ? "Type at least 2 letters." : "Nothing matches that.")); return; }
    for (const g of r.data.groups) {
      bodyEl.append(panel(`${g.label} (${g.items.length})`, miniList(g.items, (x) => {
        const li = el("li");
        const a = el("a", "", x.title);
        a.href = x.href;
        li.append(a, el("span", "muted", x.sub || ""));
        return li;
      }, "")));
    }
  }

  /* the whole log (admins) */
  function activityPage() {
    fail("");
    const bodyEl = detail("#/", "home", "", "activity log");
    const areas = [["", "Everything"], ["member", "members"], ["application", "applications"], ["unit", "org chart"], ["import", "Team Map imports"],
      ...Object.values(schema).map((c) => [`record:${c.key}`, c.label]), ["ip", "what's on: IPs"], ["event", "what's on: events"],
      ...(me.role === "master" ? [["account", "accounts"], ["session", "sign-ins"]] : [])];
    const area = select("Area", areas, "", "db-select");
    area.id = "log-area";
    const who = searchBox("Who…");
    who.id = "log-who";
    const bar = el("div", "db-toolbar");
    bar.append(area, who);
    const list = el("ol", "db-tl db-tl--log");
    const more = button("Load more", "", () => load(true), "log-more");
    const p = el("section", "db-panel");
    const inner = el("div", "db-panel__body");
    inner.append(list, more);
    p.append(bar, inner);
    bodyEl.append(el("p", "db-note", "Every change in the portal, newest first. Notes left on records show here too."), p);
    let last = null;
    async function load(append) {
      const r = await get(`/api/admin/home?${params({ view: "activity", area: area.value, who: who.value.trim(), before: append && last ? String(last) : "" })}`);
      if (!r || !r.ok) return fail(errText(r, "Couldn't load the log."));
      const items = r.data.entries.map((e) => entryNode(e, false, null));
      if (append) list.append(...items); else list.replaceChildren(...items);
      if (!append && !items.length) list.append(el("li", "db-note", "Nothing logged yet."));
      last = r.data.entries.length ? r.data.entries[r.data.entries.length - 1].id : last;
      more.hidden = r.data.entries.length < 100;
    }
    let t;
    [area, who].forEach((x) => x.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(false), 250); }));
    load(false);
  }

  /* privacy (Master Admins) */
  function privacyPage() {
    fail("");
    const bodyEl = detail("#/", "home", "", "privacy");
    const threeYears = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10);
    const date = el("input", "db-input");
    date.type = "date";
    date.id = "purge-before";
    date.value = threeYears;
    const lab = el("label", "db-label", "Applied before");
    lab.htmlFor = "purge-before";
    const out = el("p", "db-note");
    const del = confirmButton("Delete them", "This can't be undone.", async () => {
      const s = await api(`/api/admin/applications?before=${date.value}`, { method: "DELETE" }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      toast(`Deleted ${s.data.count} applications.`);
      out.textContent = "Done.";
      del.hidden = true;
    });
    del.hidden = true;
    const check = button("Check how many", "", async () => {
      const s = await api(`/api/admin/applications?before=${date.value}&dry=1`, { method: "DELETE" }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      out.textContent = s.data.count ? `${s.data.count} applications from people who didn't join were submitted before ${day(date.value)}.` : "None to delete.";
      del.hidden = !s.data.count;
    }, "purge-check");
    const row = el("div", "db-actions");
    row.append(check, del);
    const box = el("div", "db-stack");
    box.append(
      el("p", "db-note", "The join page's privacy notice promises to delete the details of people who don't join within 3 years after recruitment closes. Applications from people who became members are kept (they're linked to their member record)."),
      lab, date, row, out,
    );
    bodyEl.append(
      panel("old applications", box),
      panel("removing someone", el("p", "db-note", "Delete their member record (members → open them → Delete record): their seats, notes about them and their name in the activity log go too. Delete their application from the application page, and their login from accounts.")),
      panel("what's kept", el("p", "db-note", "The activity log keeps who changed what, and when, so mistakes can be traced. Notes on a person's record go when the record is deleted.")),
    );
  }

  /* ───────────── which view ───────────── */
  const ROUTES = [
    [/^#\/$/, () => homePage(), "home"],
    [/^#\/members$/, () => membersList(), "members"],
    [/^#\/m\/(new|\d+)$/, (m) => memberProfile(m[1]), "members"],
    [/^#\/members\/chart$/, () => orgChart(), "members"],
    [/^#\/org\/new\/(division|domain|team)(?:\/(\d+))?$/, (m) => unitForm("new", m[1], m[2]), "members", ["master", "admin"]],
    [/^#\/org\/import$/, () => importPage(), "members", ["master", "admin"]],
    [/^#\/org\/(\d+)$/, (m) => unitForm(m[1]), "members", ["master", "admin"]],
    [/^#\/applications$/, () => applicationsList(), "applications", ["master", "admin"]],
    [/^#\/a\/(\d+)$/, (m) => applicationDetail(m[1]), "applications", ["master", "admin"]],
    [/^#\/whats-on$/, () => whatsOn(), "whats-on", ["master", "admin"]],
    [/^#\/w\/(ip|event)\/(new|\d+)$/, (m) => whatsOnForm(m[1], m[2]), "whats-on", ["master", "admin"]],
    [/^#\/accounts$/, () => accountsList(), "accounts", ["master"]],
    [/^#\/accounts\/new(?:\/(\d+))?$/, (m) => accountForm(m[1]), "accounts", ["master"]],
    [/^#\/accounts\/(\d+)$/, (m) => accountDetail(m[1]), "accounts", ["master"]],
    [/^#\/r\/([a-z_]+)$/, (m) => collectionList(m[1]), (m) => m[1], null, (m) => Boolean(schema[m[1]])],
    [/^#\/r\/([a-z_]+)\/(new|\d+)$/, (m) => recordPage(m[1], m[2]), (m) => m[1], null, (m) => Boolean(schema[m[1]])],
    [/^#\/search\/(.+)$/, (m) => searchPage(decodeURIComponent(m[1])), "search"],
    [/^#\/activity$/, () => activityPage(), "activity", ["master", "admin"]],
    [/^#\/privacy$/, () => privacyPage(), "privacy", ["master"]],
  ];

  function route() {
    if (!me) return;
    const hash = location.hash || "#/";
    const hit = ROUTES.find(([re, , , roles, ok]) => re.test(hash) && (!roles || roles.includes(me.role)) && (!ok || ok(hash.match(re))));
    if (!hit) { location.hash = "#/"; return; }
    const m = hash.match(hit[0]);
    const tab = typeof hit[2] === "function" ? hit[2](m) : hit[2];
    $$("#tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    hit[1](m);
  }
  addEventListener("hashchange", route);

  /* ───────────── start ───────────── */
  api("/api/admin/session")
    .then((r) => (r.ok ? signedIn(r.data.user) : signedOut()))
    .catch(() => signedOut());
})();

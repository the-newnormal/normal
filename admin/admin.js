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
    bad_record_link: "One of the linked records isn't there any more.",
    keep_yourself: "Keep yourself or your team on it, or ask an admin to hand it over.",
    not_in_team: (f) => `${f}: choose someone from the team that looks after partners (ticked on its org chart page).`,
    one_each: (f, d) => `${d.other ? `That person is already the ${f.toLowerCase()} of ${d.other}. ` : ""}Each person leads one partnership.`,
    empty_note: "Write something first.",
    bad_seats: "A person can hold up to 10 seats.",
    bad_import: "That file couldn't be imported. Nothing was changed.",
  };
  const errText = (r, fallback) => {
    const e = r && r.data ? ERRORS[r.data.error] : null;
    return (typeof e === "function" ? e(r.data.field || "that", r.data) : e) || fallback || "Couldn't save that. Try again.";
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
    await loadFinMe();
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
    let more = null; // "More details": the fields marked more, folded at the end
    for (const d of defs) {
      const wrap = el("div", `db-field${d.wide ? " db-field--wide" : ""}`);
      if (d.section && !d.more) f.append(el("h3", "db-form__section db-field--wide", d.section));
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
        for (const [v, t, flags] of d.options) {
          const lab = el("label", "db-check");
          if (flags && flags.gone) lab.dataset.gone = "1"; // offered only if already picked (a contact who moved on)
          const box = el("input");
          box.type = "checkbox";
          box.value = v;
          box.checked = picked.includes(v);
          lab.append(box, t);
          input.append(lab);
        }
        if (!d.options.length) input.append(el("span", "db-note", "No one to pick yet."));
        if (d.chips) {
          // chips: what's picked is solid (tap to remove); a short list shows the rest as "+ name"; a long one, what you search for
          input.classList.add("db-checks--chips");
          const find = el("input", "db-input db-chips__find");
          find.type = "search";
          find.placeholder = "Search to add…";
          find.setAttribute("aria-label", `Search ${d.label}`);
          find.id = `find-${d.key}`;
          const box = input;
          const refresh = () => {
            const q = find.value.trim().toLowerCase();
            const labs = $$(".db-check", box).filter((l) => !l.classList.contains("is-out"));
            const open = labs.filter((l) => !$("input", l).checked && !l.dataset.gone);
            const few = open.length <= 12;
            find.hidden = few && !q;
            let shown = 0;
            for (const l of labs) {
              const on = $("input", l).checked;
              if (l.dataset.gone && !on) { l.classList.add("is-hidden"); continue; }
              const match = q ? l.textContent.toLowerCase().includes(q) && shown < 24 : few;
              if (!on && match) shown += 1;
              l.classList.toggle("is-hidden", !on && !match);
            }
          };
          find.addEventListener("input", refresh);
          find.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const first = $$(".db-check:not(.is-hidden):not(.is-out)", box).find((l) => !$("input", l).checked);
            if (!first) return;
            $("input", first).checked = true;
            find.value = "";
            box.dispatchEvent(new Event("change", { bubbles: true }));
          });
          box.addEventListener("change", () => { if (find.value) { find.value = ""; } refresh(); });
          box.refreshChips = refresh;
          wrap.append(input, find);
          refresh();
          if (d.hint) wrap.append(el("p", "db-hint", d.hint));
        } else if (d.options.length > 12) {
          const find = el("input", "db-input db-checks__find");
          find.type = "search";
          find.placeholder = "Find…";
          find.setAttribute("aria-label", `Find in ${d.label}`);
          const box = input;
          find.addEventListener("input", () => $$(".db-check", box).forEach((l) => { l.hidden = !l.textContent.toLowerCase().includes(find.value.toLowerCase()) && !$("input", l).checked; }));
          wrap.append(find);
          input.classList.add("is-long");
        }
        if (!d.chips) {
          wrap.append(input);
          if (d.hint) wrap.append(el("p", "db-hint", d.hint));
        }
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
      if (d.more) {
        if (!more) {
          more = el("details", "db-more db-field--wide");
          more.append(el("summary", "", "More details"));
          more.grid = el("div", "db-form");
          more.append(more.grid);
        }
        more.grid.append(wrap);
      } else f.append(wrap);
    }
    if (more) f.append(more);
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
  let listRun = 0; // each load's number: only the latest one fills the table (not a slow earlier one, or another list's)
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
        const run = ++listRun;
        fail("");
        const [r] = await Promise.all([get("/api/admin/members?" + params({ q: q.value.trim(), unit: unit.value, status: status.value })), refreshUnits()]);
        if (run !== listRun) return;
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
    $("#org-actions").replaceChildren(...(isAdmin() ? [linkButton("Import from Team Map", "#/org/import"), linkButton("+ add division", "#/org/new/division", "primary")] : []));
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
    const groups = isNew ? [] : org.managerGroups || [];
    for (const g of groups) defs.push({ key: `manages_${g.key}`, label: g.label, type: "checkbox", wide: true });

    const values = { ...unit, parent_id: unit.parent_id === null ? "" : String(unit.parent_id), overseers: (unit.overseers || []).map(String) };
    for (const g of groups) values[`manages_${g.key}`] = (org.managers || {})[g.key] === unit.id;
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
        if (groups.length) {
          json.manages = groups.filter((g) => vals[`manages_${g.key}`]).map((g) => g.key);
          groups.forEach((g) => delete json[`manages_${g.key}`]);
        }
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
        const run = ++listRun;
        fail("");
        const r = await get("/api/admin/applications?" + params(vals()));
        if (run !== listRun) return;
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
        { label: "Role", cls: "is-nowrap", cell: (a) => nodes(pill(ROLE_NAMES[a.role], a.role), (a.finance || a.role === "master") && pill("finance", "accepted")) },
        { label: "Status", cls: "is-nowrap", cell: (a) => nodes(a.fixed ? pill("set in Vercel", "active") : pill(STATE_NAMES[a.state], a.state), a.username === me.username && pill("you", "you")) },
        { label: "Member record", cls: "is-nowrap", cell: (a) => (a.member_id ? `${a.member_name} (${rid("M", a.member_id)})` : "") },
        { label: "Last sign-in", cls: "is-nowrap is-muted", cell: (a) => (a.fixed ? "" : a.last_login ? when(a.last_login) : "never") },
      ];
      loadRows = async () => {
        const run = ++listRun;
        fail("");
        const r = await get("/api/admin/accounts");
        if (run !== listRun) return;
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
      { key: "finance", label: "On the Finance team (final approval, disbursements, bank, budgets)", type: "checkbox" },
    ];
    const { form: f, inputs } = buildForm(defs, { name: pre ? pre.name : "", username: pre ? usernameFrom(pre.name) : "", role: "member", member: pre ? String(pre.id) : "new", finance: false }, {
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
    const finToggle = button(a.role === "master" ? "Finance team (as Master Admin)" : a.finance ? "Remove from the Finance team" : "Add to the Finance team", "", async () => {
      const s = await api("/api/admin/accounts", { method: "PATCH", json: { id: a.id, finance: !a.finance } }).catch(() => null);
      if (!s || !s.ok) return fail(errText(s));
      listKey = null;
      toast(a.finance ? "Removed from the Finance team." : "Added to the Finance team.");
      accountDetail(id);
    }, "toggle-finance");
    finToggle.disabled = a.role === "master";
    acts.append(lab, role, link, toggle, finToggle, del, el("p", "db-note", "Changing the role or disabling signs them out straight away. Master Admins are always on the Finance team."));
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
    receipt: '<path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z"/><path d="M6 5h4M6 8h4M6 11h2"/>',
    pie: '<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5H8z"/><path d="M10 1.5A5 5 0 0 1 14.5 6H10z"/>',
    send: '<path d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5z"/>',
    bank: '<path d="M2 6 8 2.5 14 6M3 6.5v6M6.3 6.5v6M9.7 6.5v6M13 6.5v6M2 13.5h12"/>',
    sliders: '<path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="5" cy="12" r="1.3"/>',
    chev: '<path d="m6 4 4 4-4 4"/>',
  };
  // the icons are fixed strings above, never anything people typed
  function icon(name) {
    const t = document.createElement("template");
    t.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.check}</svg>`;
    return t.content.firstChild;
  }

  // the sidebar: home; one entry per hat (people; the modules, by group; finance), the open hat showing its sections
  // underneath; then the admin pages
  let hatList = [];
  function buildNav() {
    const nav = $("#tabs");
    nav.replaceChildren();
    const link = (tab, label, href, ic) => {
      const a = el("a");
      a.href = href;
      a.dataset.tab = tab;
      if (ic) a.append(icon(ic));
      a.append(label);
      return a;
    };
    const add = (...args) => nav.append(link(...args));
    hatList = [];
    const people = [["members", "members", "#/members"], ["chart", "org chart", "#/members/chart"]];
    if (isAdmin()) people.push(["applications", "applications", "#/applications"]);
    hatList.push({ key: "people", label: "people", icon: "members", items: people });
    const groups = new Map();
    for (const c of Object.values(schema)) {
      if (!groups.has(c.group)) groups.set(c.group, { key: `g-${String(c.group).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: c.group, icon: c.icon, items: [] });
      groups.get(c.group).items.push([c.key, c.label, `#/r/${c.key}`]);
    }
    hatList.push(...groups.values());
    const money = [["fin-claims", "claims", "#/fin/claims"]];
    if (finMe.finance || finMe.isLead) money.push(["fin-budgets", "budgets", "#/fin/budgets"]);
    if (finMe.finance) money.push(["fin-payouts", "disbursements", "#/fin/payouts"], ["fin-bank", "bank", "#/fin/bank"], ["fin-setup", "setup", "#/fin/setup"]);
    hatList.push({ key: "finance", label: "finance", icon: "coin", items: money });

    add("home", "home", "#/", "home");
    for (const h of hatList) {
      const grp = el("div", "db-hatgrp");
      grp.dataset.hat = h.key;
      const head = link(h.key, h.label, h.items[0][2], h.icon);
      grp.append(head);
      if (h.items.length > 1) {
        const chev = icon("chev");
        chev.classList.add("db-chev");
        head.append(chev);
        const sub = el("div", "db-subnav");
        sub.setAttribute("role", "group");
        sub.setAttribute("aria-label", h.label);
        sub.append(...h.items.map(([key, label, href]) => link(key, label, href)));
        grp.append(sub);
      }
      nav.append(grp);
    }
    const admin = [];
    if (isAdmin()) admin.push(["whats-on", "what's on", "#/whats-on", "globe"]);
    if (me.role === "master") admin.push(["accounts", "accounts", "#/accounts", "key"]);
    if (isAdmin()) admin.push(["activity", "activity log", "#/activity", "history"]);
    if (me.role === "master") admin.push(["privacy", "privacy", "#/privacy", "shield"]);
    if (admin.length) {
      nav.append(el("p", "db-side__label", "Admin"));
      admin.forEach((i) => add(...i));
    }
  }
  // where you are: the open hat shows its sections (a hat with one section is that section)
  function markNav(hat, tab) {
    const nav = $("#tabs");
    const target = hat && hat.items.length === 1 ? hat.key : tab;
    $$("#tabs a").forEach((a) => (a.dataset.tab === target ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $$("#tabs .db-hatgrp").forEach((g) => g.classList.toggle("is-open", Boolean(hat) && g.dataset.hat === hat.key));
    // on phones the sidebar is a scrolling strip: bring where you are into view, once it's showing
    requestAnimationFrame(() => {
      if (nav.scrollWidth <= nav.clientWidth + 1) return;
      const head = nav.querySelector(".is-open") || nav.querySelector("a[aria-current]");
      const cur = nav.querySelector("a[aria-current]") || head;
      if (!head) return;
      let left = head.offsetLeft - 12;
      if (cur.offsetLeft + cur.offsetWidth > left + nav.clientWidth) left = cur.offsetLeft + cur.offsetWidth - nav.clientWidth + 12;
      nav.scrollLeft = Math.max(0, left);
    });
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
    out.eligible = {};
    for (const f of cfg.fields.filter((x) => x.fromManagers)) {
      const r = await get(`/api/admin/records?${params({ c, eligible: f.key })}`);
      if (r && r.ok) out.eligible[f.key] = r.data;
    }
    for (const to of new Set(cfg.fields.filter((x) => (x.type === "link" || x.type === "links") && schema[x.to]).map((x) => x.to))) {
      const r = await get(`/api/admin/records?c=${to}&lite=1`);
      out.links[to] = r && r.ok ? r.data.records : [];
    }
    return out;
  }
  const peopleOptions = (look) => look.people.map((p) => [String(p.id), p.name]);
  const linkLabel = (to, r) => (schema[to] && schema[to].pickerSub ? (r.sub ? `${r.title} · ${r.sub}` : r.title) : `${r.code} ${r.title}`);
  const linkOptions = (look, to) => (look.links[to] || []).map((r) => [String(r.id), linkLabel(to, r), r.gone ? { gone: true } : undefined]);
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
        const late = f.key === cfg.overdue && !isDone(cfg, data) && v < todaySG();
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
      case "links": {
        const named = (x) => (refs.links[f.to] || {})[x];
        if (inTable) return v.map((x) => named(x) || "(removed)").join(", ");
        const box = el("span", "db-names");
        v.forEach((x, i) => box.append(named(x) ? link(named(x), `#/r/${f.to}/${x}`) : "(removed)", i < v.length - 1 ? ", " : ""));
        return box;
      }
      case "long": return inTable ? String(v).slice(0, 80) + (String(v).length > 80 ? "…" : "") : el("p", "db-notes", v);
      default: return String(v);
    }
  }

  // a module field as a form question
  function formDef(f, look) {
    const base = { key: f.key, label: f.label + (f.type === "money" ? " (S$)" : ""), required: f.required, hint: f.hint, wide: f.wide || f.type === "members" || f.type === "links",
      section: f.section, more: f.more };
    switch (f.type) {
      case "long": return { ...base, type: "textarea" };
      case "select": return { ...base, type: "select", options: f.required ? f.options : [["", "—"], ...f.options] };
      case "check": return { ...base, type: "checkbox" };
      case "number": return { ...base, type: "number" };
      case "money": return { ...base, type: "number", step: "0.01" };
      case "phone": return { ...base, type: "tel" };
      case "member": {
        const el2 = f.fromManagers && look.eligible && look.eligible[f.key];
        if (!el2) return { ...base, type: "select", options: [["", "—"], ...peopleOptions(look)] };
        return { ...base, type: "select", hint: el2.team ? base.hint : `${base.hint || ""} No team is marked as looking after partners yet: tick that on the Relationships team's org chart page to list only them here.`.trim(),
          options: [["", "—"], ...el2.people.map((x) => [String(x.id), x.on ? `${x.name} · leads ${x.on.title}` : `${x.name} · free`])] };
      }
      case "members": return { ...base, type: "checks", chips: true, options: peopleOptions(look) };
      case "unit": return { ...base, type: "select", options: [["", "—"], ...unitOptions(look.units)] };
      case "link": return { ...base, type: "select", options: [["", "—"], ...linkOptions(look, f.to)] };
      case "links": return { ...base, type: "checks", chips: true, options: linkOptions(look, f.to) };
      default: return { ...base, type: f.type };
    }
  }
  function formValues(fieldsList, data) {
    const out = {};
    for (const f of fieldsList) {
      const v = data[f.key];
      if (f.type === "members" || f.type === "links") out[f.key] = (Array.isArray(v) ? v : v ? [v] : []).map(String);
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
      if (cfg.ownTeam) scopeOpts.push(["team", "My team's"]);
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
        const opts = f.type === "unit" ? unitOptions(look.units) : f.type === "link" || f.type === "links" ? linkOptions(look, f.to) : peopleOptions(look);
        const keep = filterEls[i].value;
        filterEls[i].append(...opts.map(([v, t]) => new Option(t, v)));
        filterEls[i].value = keep;
      }));
      if (cfg.admin) $("#list-actions").append(button("Export CSV", "", () => download(`/api/admin/records?${params({ c, format: "csv", q: q.value.trim() })}`)));
      if (cfg.canCreate) $("#list-actions").append(linkButton(`+ ${cfg.newLabel || `new ${cfg.noun}`}`, `#/r/${c}/new`, "primary"));

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
        const run = ++listRun;
        fail("");
        const query = { c, q: q.value.trim() };
        if (scope.value === "mine") query.mine = "1";
        if (scope.value === "team") query.team = "1";
        if (scope.value === "open") query.open = "1";
        if (scope.value === "archived") query.archived = "1";
        filterFields.forEach((f, i) => { if (filterEls[i].value) query[`f.${f.key}`] = filterEls[i].value; });
        const r = await get(`/api/admin/records?${params(query)}`);
        if (run !== listRun) return;
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

  /* partners' org charts: the parts under a partner, its people by who reports to whom, every meeting with them */
  async function chartPanels(c, rec, into) {
    const cfg = schema[c];
    const ch = cfg.chart;
    const r = await get(`/api/admin/records?${params({ c, id: String(rec.id), chart: "1" })}`);
    if (!r || !r.ok) return;
    const { units, ancestors, people, meetings, meetingRefs, canAdd } = r.data;
    const pc = schema[ch.people.c];
    const levels = ch.people.levels || [];
    const lv = (x) => x.data[ch.people.level];
    const order = (a, b) => (levels.indexOf(lv(a)) + 1 || 99) - (levels.indexOf(lv(b)) + 1 || 99) || String(a.data[pc.title]).localeCompare(String(b.data[pc.title]));
    // how often we've met each person, and when last
    const met = {};
    for (const m of meetings) {
      for (const pid of m.data[ch.meetings.people] || []) {
        const k = String(pid);
        met[k] = met[k] || { n: 0, last: "" };
        met[k].n += 1;
        if ((m.data.date || "") > met[k].last) met[k].last = m.data.date || "";
      }
    }
    const box = el("div", "crm-chart");
    if (ancestors.length) {
      const up = el("p", "crm-up", "Part of ");
      ancestors.forEach((a, i) => { const l = el("a", "", a.title); l.href = `#/r/${c}/${a.id}`; up.append(l, i < ancestors.length - 1 ? " › " : ""); });
      box.append(up);
    }
    // the levels we reach, among people still in their roles
    const current = people.filter((x) => x.data.status !== "moved on");
    if (current.length) {
      const strip = el("div", "crm-levels");
      strip.append(el("span", "crm-levels__label", "Who we know:"));
      for (const name of levels) {
        const n = current.filter((x) => lv(x) === name).length;
        strip.append(el("span", `crm-level${n ? "" : " is-none"}`, `${n} ${name}`));
      }
      const unknown = current.filter((x) => !levels.includes(lv(x))).length;
      if (unknown) strip.append(el("span", "crm-level is-none", `${unknown} level not set`));
      box.append(strip);
    }
    const byUnit = new Map(units.map((u) => [u.id, []]));
    for (const x of people) { const u = Number(x.data[ch.people.at]); if (byUnit.has(u)) byUnit.get(u).push(x); }
    const kids = new Map(units.map((u) => [u.id, []]));
    for (const u of units) { const up = Number(u.data[ch.parent]); if (u.id !== rec.id && kids.has(up)) kids.get(up).push(u); }
    const seenUnits = new Set();
    const unitNode = (u, depth) => {
      seenUnits.add(u.id);
      const wrap = el("div", `crm-unit${depth ? "" : " is-root"}`);
      const head = el("div", "crm-unit__head");
      if (depth) {
        const a = el("a", "crm-unit__name", u.data[cfg.title] || "(untitled)");
        a.href = `#/r/${c}/${u.id}`;
        head.append(a);
      } else head.append(el("strong", "crm-unit__name", "Org chart"));
      const tools = el("span", "crm-unit__tools");
      if (canAdd[ch.people.c]) tools.append(linkButton("+ person", `#/r/${ch.people.c}/new?${params({ [ch.people.at]: String(u.id) })}`, "sm"));
      if (canAdd[c]) tools.append(linkButton("+ department or branch", `#/r/${c}/new?${params({ [ch.parent]: String(u.id) })}`, "sm"));
      head.append(tools);
      wrap.append(head);
      // people here, under whoever they report to (when that person is here too)
      const here = byUnit.get(u.id) || [];
      const ids = new Set(here.map((x) => x.id));
      const below = new Map();
      const tops = [];
      for (const x of here) {
        const boss = Number(x.data[ch.people.reportsTo]);
        if (boss && boss !== x.id && ids.has(boss)) { if (!below.has(boss)) below.set(boss, []); below.get(boss).push(x); } else tops.push(x);
      }
      const seen = new Set();
      const personNode = (x) => {
        seen.add(x.id);
        const li = el("li", `crm-person${x.data.status === "moved on" ? " is-gone" : ""}`);
        const row = el("div", "crm-person__row");
        const a = el("a", "crm-person__name", x.data[pc.title] || "(no name)");
        a.href = `#/r/${ch.people.c}/${x.id}`;
        row.append(a);
        if (x.data.title) row.append(el("span", "muted", x.data.title));
        if (lv(x)) row.append(pill(lv(x), "level"));
        if (x.data.status === "moved on") row.append(pill("moved on", "disabled"));
        const m = met[String(x.id)];
        row.append(el("span", "crm-met muted", m ? `met ${m.n}× · last ${day(m.last)}` : "not met yet"));
        li.append(row);
        const subs = (below.get(x.id) || []).filter((y) => !seen.has(y.id)).sort(order);
        if (subs.length) {
          const ul = el("ul", "crm-people");
          subs.forEach((y) => ul.append(personNode(y)));
          li.append(ul);
        }
        return li;
      };
      if (here.length) {
        const ul = el("ul", "crm-people");
        tops.sort(order).forEach((x) => ul.append(personNode(x)));
        here.filter((x) => !seen.has(x.id)).sort(order).forEach((x) => ul.append(personNode(x))); // a loop in "reports to"
        wrap.append(ul);
      } else wrap.append(el("p", "db-note", depth ? "No one here yet." : "No one at this level yet."));
      const sub = (kids.get(u.id) || []).filter((k) => !seenUnits.has(k.id)).sort((a, b) => String(a.data[cfg.title]).localeCompare(String(b.data[cfg.title])));
      if (sub.length && depth < 12) {
        const k = el("div", "crm-units");
        sub.forEach((s2) => k.append(unitNode(s2, depth + 1)));
        wrap.append(k);
      }
      return wrap;
    };
    const root = units.find((u) => u.id === rec.id);
    if (root) box.append(unitNode(root, 0));
    into.append(panel(`people (${current.length}${people.length > current.length ? ` + ${people.length - current.length} moved on` : ""})`, box));

    // every meeting with them, newest first
    if (schema[ch.meetings.c]) {
      const mc = schema[ch.meetings.c];
      const list = el("ul", "db-mini crm-meetings");
      for (const m of meetings.slice(0, 60)) {
        const li = el("li");
        const a = el("a", "", m.data[mc.title] || "(untitled)");
        a.href = `#/r/${ch.meetings.c}/${m.id}`;
        const who = (m.data[ch.meetings.people] || []).map((pid) => ((meetingRefs.links || {})[ch.people.c] || {})[pid]).filter(Boolean);
        li.append(el("span", "mono muted", m.data.date ? day(m.data.date) : ""), a, who.length ? el("span", "muted", who.join(", ")) : null);
        list.append(li);
      }
      const log = schema[ch.meetings.c].canCreate ? linkButton("+ log a meeting", `#/r/${ch.meetings.c}/new?${params({ [ch.meetings.orgs]: String(rec.id) })}`, "sm") : null;
      into.append(panel(`meetings (${meetings.length})`, meetings.length ? list : el("p", "db-note", "No meetings logged with them yet."), log));
    }
  }

  // "+ someone new" under a links field marked quickAdd: adds the record (say, a contact met in this meeting) and ticks it
  function addQuickAdds(cfg, inputs, look) {
    for (const f of cfg.fields.filter((x) => x.quickAdd && x.type === "links" && inputs && inputs[x.key])) {
      const to = schema[f.to];
      if (!to || !to.canCreate) continue;
      const box = inputs[f.key];
      const orgField = to.fields.find((x) => x.type === "link" && x.required);
      const levelField = to.fields.find((x) => x.key === "level" && x.type === "select");
      const roleField = to.fields.find((x) => x.key === "title" && x.key !== to.title);
      const orgsHere = orgField && cfg.fields.find((x) => x.type === "links" && x.to === orgField.to && inputs[x.key]);
      const det = el("details", "crm-quick");
      det.append(el("summary", "", "+ someone new"));
      const name = el("input", "db-input");
      name.placeholder = "Name";
      name.setAttribute("aria-label", "Name");
      name.id = `qa-${f.key}-name`;
      const role = roleField ? el("input", "db-input") : null;
      if (role) { role.placeholder = roleField.label; role.setAttribute("aria-label", roleField.label); role.id = `qa-${f.key}-role`; }
      const org = orgField ? select(orgField.label, [["", `${orgField.label}…`], ...linkOptions(look, orgField.to)], undefined, "db-input") : null;
      if (org) org.id = `qa-${f.key}-org`;
      const level = levelField ? select(levelField.label, [["", `${levelField.label}…`], ...levelField.options], undefined, "db-input") : null;
      if (level) level.id = `qa-${f.key}-level`;
      const msg = el("p", "db-error");
      det.addEventListener("toggle", () => {
        if (!det.open || !org || org.value || !orgsHere) return;
        const first = $("input:checked", inputs[orgsHere.key]);
        if (first) org.value = first.value;
      });
      const add = button("Add", "", async () => {
        msg.textContent = "";
        if (!name.value.trim()) { msg.textContent = "Add their name."; name.focus(); return; }
        if (org && !org.value) { msg.textContent = `Choose their ${orgField.label.toLowerCase()}.`; org.focus(); return; }
        const data = { [to.title]: name.value.trim() };
        if (role && role.value.trim()) data[roleField.key] = role.value.trim();
        if (org) data[orgField.key] = org.value;
        if (level && level.value) data[levelField.key] = level.value;
        const s2 = await api("/api/admin/records", { method: "POST", json: { c: f.to, data } }).catch(() => null);
        if (!s2 || !s2.ok) { msg.textContent = errText(s2); return; }
        const lab = el("label", "db-check");
        const tick = el("input");
        tick.type = "checkbox";
        tick.value = String(s2.data.record.id);
        tick.checked = true;
        const orgName = org ? org.options[org.selectedIndex].text : "";
        lab.append(tick, orgName ? `${data[to.title]} · ${orgName}` : data[to.title]);
        if (org) lab.dataset.of = org.value;
        $$(".db-note", box).forEach((n) => n.remove());
        box.append(lab);
        if (box.refreshChips) box.refreshChips();
        if (orgsHere && org) {
          const t = $(`input[value="${org.value}"]`, inputs[orgsHere.key]);
          if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        (look.links[f.to] = look.links[f.to] || []).push({ id: s2.data.record.id, code: s2.data.record.code, title: data[to.title], sub: orgName, ...(org ? { of: Number(org.value) } : {}) });
        toast(`${data[to.title]} added to ${to.label}.`);
        name.value = "";
        if (role) role.value = "";
        if (level) level.value = "";
      }, `qa-${f.key}-add`);
      const row = el("div", "crm-quick__row");
      row.append(...nodes(name, role, org, level, add));
      det.append(row, msg);
      box.after(det);
    }
  }

  // a links field marked narrowBy (a meeting's "their side") lists only the records at what's ticked in that field
  // (its organisations, and their departments and branches); ticked ones always stay; nothing ticked lists everyone
  function narrowPickers(cfg, inputs, look) {
    for (const f of cfg.fields.filter((x) => x.narrowBy && x.type === "links" && inputs && inputs[x.key] && inputs[x.narrowBy])) {
      const by = cfg.fields.find((x) => x.key === f.narrowBy);
      const box = inputs[f.key], byBox = inputs[f.narrowBy];
      const str = (v) => (v === null || v === undefined ? null : String(v));
      const at = new Map((look.links[f.to] || []).map((r) => [String(r.id), str(r.of)]));
      // the organisations' own tree (a branch is part of a department, part of a partner)
      const tree = schema[by.to] && schema[by.to].chart && schema[by.to].chart.parent === schema[by.to].pickerSub;
      const up = new Map((look.links[by.to] || []).map((r) => [String(r.id), tree ? str(r.of) : null]));
      const note = el("p", "db-hint db-narrow");
      box.before(note);
      const refresh = () => {
        const picked = $$("input:checked", byBox).map((i) => i.value);
        const open = new Set(picked);
        for (let grew = true; grew;) {
          grew = false;
          for (const [id, parent] of up) if (parent && open.has(parent) && !open.has(id)) { open.add(id); grew = true; }
        }
        let shown = 0;
        for (const lab of $$(".db-check", box)) {
          const tick = $("input", lab);
          const where = at.has(tick.value) ? at.get(tick.value) : lab.dataset.of || null;
          const out = picked.length > 0 && !tick.checked && !open.has(where);
          lab.classList.toggle("is-out", out);
          if (!out) shown += 1;
        }
        if (box.refreshChips) box.refreshChips();
        note.textContent = !picked.length ? "" : shown ? "Showing the people at the organisations ticked above (and their departments and branches)."
          : "No one from there yet: add them with + someone new.";
      };
      byBox.addEventListener("change", refresh);
      refresh();
    }
  }

  // a module's fields in its form's order
  const formFields = (cfg) => (cfg.formOrder ? [...cfg.formOrder.map((k) => cfg.fields.find((f) => f.key === k)).filter(Boolean), ...cfg.fields.filter((f) => !cfg.formOrder.includes(f.key))] : cfg.fields);

  /* one record */
  async function recordPage(c, id, prefill = {}) {
    const cfg = schema[c];
    fail("");
    const look = await lookups(c);
    if (id === "new") {
      const body = detail(`#/r/${c}`, cfg.label, "new", cfg.newLabel || `new ${cfg.noun}`);
      if (!cfg.canCreate) return fail(ERRORS.not_allowed);
      const defs = formFields(cfg).filter((f) => cfg.createFields.includes(f.key)).map((f) => formDef(f, look));
      for (const f of cfg.fields) {
        if (f.today && !prefill[f.key]) prefill[f.key] = todaySG();
        if (f.meDefault && me.memberId && !prefill[f.key]) prefill[f.key] = String(me.memberId);
      }
      const given = Object.fromEntries(cfg.fields.filter((f) => prefill[f.key]).map((f) => [f.key, f.type === "links" || f.type === "members" ? [prefill[f.key]] : prefill[f.key]]));
      const { form: f, inputs: newInputs } = buildForm(defs, formValues(cfg.fields, { ...cfg.defaults, ...given }), {
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
      addQuickAdds(cfg, newInputs, look);
      narrowPickers(cfg, newInputs, look);
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

    // a partner's org chart: the parts under it, its people and every meeting with them
    if (cfg.chart) await chartPanels(c, rec, related);
    // records in other modules that point at this one (a contact's meetings, the people who report to them)
    for (const other of cfg.chart ? [] : Object.values(schema)) {
      const via = other.fields.find((f) => (f.type === "link" || f.type === "links") && f.to === c);
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
      const what = other.key === c ? `${via.label.toLowerCase()} them` : other.label;
      related.append(panel(`${what} (${rr.data.records.length})`, ul, rr.data.records.length > 8 ? more : null));
    }

    if (cfg.chart) main.append(related); // a partner's people and meetings come before the long form
    if (canEdit.length) {
      const editable = formFields(cfg).filter((f) => canEdit.includes(f.key));
      const { form: f, inputs: editInputs } = buildForm(editable.map((x) => formDef(x, look)), formValues(editable, rec.data), {
        submit: "Save changes",
        onSubmit: async (vals, status) => {
          const s = await api("/api/admin/records", { method: "PATCH", json: { c, id: rec.id, data: vals } }).catch(() => null);
          if (!s || !s.ok) { status.textContent = errText(s); return; }
          listKey = null;
          toast("Saved.");
          recordPage(c, String(rec.id));
        },
      });
      addQuickAdds(cfg, editInputs, look);
      narrowPickers(cfg, editInputs, look);
      main.append(panel(editsAll ? "details" : "update", f));
    }
    main.append(...(cfg.chart ? [] : [related]), timelinePanel(`record:${c}`, rec.id));

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
    const sum = (list) => (list || []).reduce((s, c) => s + c.amount_cents, 0);

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
        ...(d.toReview ? [stat(d.toReview.length, "claims waiting for you", "#/fin/claims/review", d.toReview.length ? cents(sum(d.toReview)) : "", d.toReview.length > 0)] : []),
        ...(d.toDisburse ? [stat(d.toDisburse.length, "claims to disburse", "#/fin/payouts", d.toDisburse.length ? cents(sum(d.toDisburse)) : "", d.toDisburse.length > 0)] : []),
        ...(k.activePartners !== undefined ? [stat(k.activePartners, "active partners", "#/r/partners")] : []),
        ...(k.pendingLinks !== undefined ? [stat(k.pendingLinks, "setup links unused", "#/accounts")] : []),
      );
      parts.push(grid);
    }

    const left = el("div", "db-home__col");
    const right = el("div", "db-home__col");
    const claimLi = (who) => (c) => {
      const li = el("li");
      li.append(el("span", "mono muted", c.code), finLink(c.description, `#/fin/c/${c.id}`), ...(who ? [el("span", "muted", c.claimant_name)] : [claimPill(c)]), el("span", "", cents(c.amount_cents)));
      return li;
    };
    if (d.counts) {
      left.append(panel("new applications", miniList(d.applications, (a) => {
        const li = el("li");
        li.append(finLink(a.name, `#/a/${a.id}`), el("span", "muted", [a.life_stage, when(a.created_at)].filter(Boolean).join(" · ")));
        return li;
      }, "None waiting."), linkButton("All →", "#/applications")));
    }
    if (d.toReview) left.append(panel("claims waiting for you", miniList(d.toReview.slice(0, 8), claimLi(true), "Nothing to review."), linkButton("All →", "#/fin/claims/review")));
    if (d.toDisburse) left.append(panel("claims to disburse", miniList(d.toDisburse.slice(0, 8), claimLi(true), "Nothing approved and waiting."), linkButton("Disbursements →", "#/fin/payouts")));
    if (d.myClaims) left.append(panel("my claims", miniList(d.myClaims, claimLi(false), "No claims. Paid for something for Normal? Claim it back."), linkButton("+ new claim", "#/fin/claims/new")));
    if (d.myMeetings) right.append(panel("my meetings", miniList(d.myMeetings, recLi("meetings", (x) => [el("span", "muted", day(x.data.date))]), "No meetings coming up.")));
    if (d.partnerships) {
      const free = d.partnerships.people.filter((x) => !x.partner).length;
      const board = miniList(d.partnerships.people, (x) => {
        const li = el("li");
        const who = el("a", "", x.name);
        who.href = `#/m/${x.id}`;
        let what;
        if (x.partner) { what = el("a", "", x.partner.title); what.href = `#/r/partners/${x.partner.id}`; } else what = el("span", "is-overdue", "not assigned yet");
        li.append(who, what);
        return li;
      }, "No one is seated in the team that looks after partners yet.");
      const note = el("p", "db-note", [free ? `${free} without a partnership.` : "Everyone has a partnership.", d.partnerships.unled ? ` ${d.partnerships.unled} partners have no lead.` : ""].join(""));
      const wrap = el("div");
      wrap.append(note, board);
      right.append(panel("partnerships", wrap, linkButton("Partners →", "#/r/partners")));
    }
    if (d.followUps && d.followUps.length) {
      right.append(panel("partner follow-ups", miniList(d.followUps, recLi("partners", (x) => [
        el("span", x.data.next_date < d.today ? "is-overdue" : "muted", `${day(x.data.next_date)}${x.data.next_date < d.today ? " · overdue" : ""}`),
        x.data.next_step ? el("span", "muted", x.data.next_step) : null,
      ]), ""), linkButton("Partners →", "#/r/partners")));
    }
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
  // New Normal's Data Protection Notice (admin/privacy-notice.html), with what's still [to be confirmed] marked
  const NOTICE_URL = "/admin/privacy-notice.html";
  function noticePanel() {
    const box = el("div", "dpn-wrap");
    box.append(el("p", "db-note", "Loading the notice…"));
    const toggle = button("Open all", "", () => {
      const open = toggle.textContent === "Open all";
      $$(".dpn-sec", box).forEach((d) => { d.open = open; });
      toggle.textContent = open ? "Close all" : "Open all";
    }, "dpn-toggle");
    (async () => {
      const r = await fetch(NOTICE_URL, { cache: "no-cache" }).catch(() => null);
      if (!r || !r.ok) { box.replaceChildren(el("p", "db-alert", "Couldn't load the notice.")); return; }
      const t = document.createElement("template");
      t.innerHTML = await r.text(); // the portal's own file, never anything people typed
      const walker = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      let tbc = 0;
      for (const n of texts) {
        if (!/\[[^\]]+\]/.test(n.nodeValue)) continue;
        const parts = document.createDocumentFragment();
        for (const part of n.nodeValue.split(/(\[[^\]]+\])/)) {
          if (/^\[[^\]]+\]$/.test(part)) {
            const m = el("mark", "dpn-tbc", part);
            m.title = "To be confirmed";
            parts.append(m);
            tbc += 1;
          } else if (part) parts.append(part);
        }
        n.replaceWith(parts);
      }
      box.replaceChildren(
        ...(tbc ? [el("p", "db-alert db-alert--warn", `Draft: ${tbc} ${tbc === 1 ? "part" : "parts"} in [brackets] still to be confirmed, highlighted below.`)] : []),
        t.content,
      );
    })();
    return panel("data protection notice", box, toggle);
  }

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
      noticePanel(),
      panel("old applications", box),
      panel("removing someone", el("p", "db-note", "Delete their member record (members → open them → Delete record): their seats, notes about them and their name in the activity log go too. Delete their application from the application page, and their login from accounts.")),
      panel("what's kept", el("p", "db-note", "The activity log keeps who changed what, and when, so mistakes can be traced. Notes on a person's record go when the record is deleted.")),
    );
  }

  /* ───────────── finance: claims, budgets, disbursements, bank (rules: lib/finance.js) ───────────── */
  let finMe = { finance: false, isLead: false, canInvoice: false, keyReady: false, rules: [], groups: {}, divisions: [] };
  const cents = (c) => money(Number(c || 0) / 100);
  const FIN_ERRORS = {
    link_member: "Your login isn't linked to a member record yet. Master Admins from Vercel: open your member record and press \"This is me\". Others: ask a Master Admin.",
    payout_key: "Finance isn't switched on yet: PAYOUT_ENCRYPTION_KEY needs setting in Vercel (see the README).",
    import_not_set_up: "Set FINANCE_SUPABASE_URL and FINANCE_SUPABASE_KEY in Vercel first (see the README).",
    import_unreachable: "Couldn't reach the finance app's database. Check FINANCE_SUPABASE_URL in Vercel.",
    import_denied: "The finance app's database refused the key: FINANCE_SUPABASE_KEY must be its service role key.",
    import_key: "The payout key doesn't match the finance app's: set FINANCE_PAYOUT_KEY in Vercel to the finance app's PAYOUT_ENCRYPTION_KEY.",
    invoice_not_allowed: "Only division leads and Finance can submit vendor invoices.",
    budget_closed: "That budget isn't open for claims.",
    bad_category: "That budget doesn't provide for that category. Choose one of its categories.",
    need_description: "Add a short description (3 characters or more).",
    bad_amount: "Enter the amount in dollars, e.g. 45.50.",
    bad_expense_date: "The purchase date can't be in the future.",
    need_vendor: "Enter the vendor's name.",
    need_receipt: "Attach at least one receipt or invoice (up to 5).",
    bad_receipt: "Attach the receipts again.",
    need_agreement: "Tick the box to agree to the declaration.",
    need_payout: "Enter your payout details.",
    vendor_payout: "Enter the vendor's payment details.",
    saved_payout_unreadable: "Your saved payout details can no longer be used. Please enter them again.",
    cant_decide: "You can't decide this claim.",
    already_decided: "This claim has already been decided.",
    need_reason: "Give a reason so the claimant can fix it.",
    not_approved: "Only approved claims can be disbursed.",
    need_reference: "Enter the bank transaction reference.",
    account_closed: "Choose an open bank account.",
    before_opening: "That date is before the account's opening balance.",
    future_date: "The date can't be in the future.",
    need_division: "Choose a division from the org chart.",
    budget_has_claims: "This budget already has claims, so it can't move to another division. Close it and create a new one there.",
    category_has_claims: "A category with claims has to stay provided.",
    bad_guideline: "Check the guideline amounts.",
    need_name: "Enter a name.",
    need_group: "Choose a group.",
    category_exists: "There's already a category with that name.",
    need_rule: "A notice needs a title and text.",
    bad_rule_link: "Links must start with https://.",
    need_last4: "Enter the last four digits of the account number.",
    account_exists: "There's already an account with that name.",
    need_note: "Add a note saying what this is.",
    balance_changed: "The balance has changed since you compared it. Compare with DBS again.",
    same_account: "Choose two different accounts.",
    reserve_short: "The reserve doesn't have that much available.",
    repay_too_much: "That's more than the budget owes the reserve.",
    budget_short: "The budget doesn't have that much available.",
    bad_file_type: "Receipts can be photos (JPEG, PNG, WebP, HEIC) or PDFs.",
    file_too_big: "That file is too big (3.5 MB at most). Save a smaller copy and try again.",
    payout_unreadable: "These payout details can't be read (the encryption key may have changed).",
  };
  const finErr = (r, fallback) => (r && r.data && (r.data.message || FIN_ERRORS[r.data.error])) || errText(r, fallback);
  const finApi = (json) => api("/api/admin/finance", { method: "POST", json }).catch(() => null);
  const finGet = (query) => get(`/api/admin/finance?${params(query)}`);
  const statusKind = (s) => ({ pending_review: "new", pending_finance: "interviewing", approved: "active", paid: "accepted", rejected: "declined" }[s] || s);
  const claimPill = (c) => pill(c.status_label, statusKind(c.status));
  const finLink = (text, href) => { const a = el("a", "", text); a.href = href; return a; };

  async function loadFinMe() {
    const r = await get("/api/admin/finance?view=me");
    finMe = r && r.ok ? r.data : finMe;
  }

  /* claims lists */
  function claimsList(scope) {
    const reviewer = finMe.finance || finMe.isLead;
    openList(`fin:${scope}`, () => {
      $("#list-title").textContent = "claims";
      const q = searchBox("Search descriptions, claimants, vendors…");
      q.id = "f-q";
      const status = select("Status", [["", "All statuses"], ...Object.entries({ pending_review: "Awaiting review", pending_finance: "Awaiting Finance", approved: "Approved", paid: "Reimbursed or settled", rejected: "Rejected" })]);
      status.id = "f-status";
      filterInputs([q, status]);
      if (reviewer) {
        const seg = el("div", "db-seg");
        for (const [key, text] of [["mine", "Mine"], ["review", "To review"], ["all", finMe.finance ? "All" : "My divisions"]]) {
          const a = finLink(text, key === "mine" ? "#/fin/claims" : `#/fin/claims/${key}`);
          if (key === scope) a.setAttribute("aria-current", "page");
          seg.append(a);
        }
        $("#list-actions").append(seg);
      }
      if (finMe.finance) $("#list-actions").append(button("Export CSV", "", () => download("/api/admin/finance?view=export")));
      $("#list-actions").append(linkButton("+ new claim", "#/fin/claims/new", "primary"));
      const columns = [
        { label: "ID", cls: "is-id", cell: (c) => c.code },
        { label: "Submitted", cls: "is-muted", cell: (c) => day(String(c.created_at).slice(0, 10)) },
        ...(scope === "mine" ? [] : [{ label: "Claimant", cell: (c) => c.claimant_name }]),
        { label: "What for", cls: "is-name", link: true, cell: (c) => c.description },
        { label: "Budget", cell: (c) => `${c.budget_name} · ${c.category_name}` },
        { label: "Kind", cell: (c) => (c.kind === "invoice" ? `invoice · ${c.vendor_name}` : "reimbursement") },
        { label: "Amount", cls: "is-right", cell: (c) => cents(c.amount_cents) },
        { label: "Status", cell: claimPill },
      ];
      loadRows = async () => {
        const run = ++listRun;
        fail("");
        const r = await finGet({ view: "claims", scope, q: q.value.trim(), status: status.value });
        if (run !== listRun) return;
        if (!r) return;
        if (!r.ok) return fail(finErr(r, "Couldn't load claims."));
        const total = r.data.claims.reduce((s, c) => s + c.amount_cents, 0);
        fillList(columns, r.data.claims, (c) => `#/fin/c/${c.id}`, r.data.claims.length,
          scope === "review" ? "Nothing waiting for your review." : scope === "mine" ? "No claims yet. Paid for something for Normal? Claim it back with \"+ new claim\"." : "No claims yet.",
          "No claims match those filters.", r.data.claims.length ? `Total ${cents(total)}` : "");
      };
    });
  }

  /* a new claim */
  async function fileToUpload(file) {
    // big photos are shrunk in the browser (receipts stay readable at 1800px)
    if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 700 * 1024 && window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
        if (blob) return { name: file.name.replace(/\.\w+$/, "") + ".jpg", type: "image/jpeg", blob };
      } catch { /* send it as it is */ }
    }
    const type = file.type || (/\.hei[cf]$/i.test(file.name) ? "image/heic" : /\.pdf$/i.test(file.name) ? "application/pdf" : "");
    return { name: file.name, type, blob: file };
  }
  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function newClaimPage() {
    fail("");
    const body = detail("#/fin/claims", "claims", "new", "new claim");
    await loadFinMe();
    if (!me.memberId) { body.append(el("p", "db-alert", FIN_ERRORS.link_member)); return; }
    if (!finMe.keyReady) body.append(el("p", "db-alert", FIN_ERRORS.payout_key));
    const br = await finGet({ view: "budgets" });
    if (!br || !br.ok) return fail(finErr(br, "Couldn't load budgets."));
    const budgets = br.data.budgets.filter((b) => b.active);
    if (!budgets.length) { body.append(el("p", "db-empty", "There are no budgets to claim against yet. Finance sets them up.")); return; }

    const submissionId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    const f = el("form", "db-form");
    f.noValidate = true;
    const field = (label, input, hint, wide) => {
      const w = el("div", `db-field${wide ? " db-field--wide" : ""}`);
      const l = el("label", "db-label", label);
      if (input.id) l.htmlFor = input.id;
      w.append(l, input);
      if (hint) w.append(el("p", "db-hint", hint));
      return w;
    };
    const input = (id, type = "text", attrs = {}) => { const i = el("input", "db-input"); i.id = id; i.type = type; Object.assign(i, attrs); return i; };

    // kind
    let kind = "reimbursement";
    const kindSeg = el("div", "db-seg db-field--wide");
    const kindBtns = {};
    for (const [k, text] of [["reimbursement", "Reimbursement: I paid"], ["invoice", "Vendor invoice: Normal pays a vendor"]]) {
      const bt = el("a", "", text);
      bt.href = "#";
      bt.id = `kind-${k}`;
      bt.addEventListener("click", (e) => { e.preventDefault(); kind = k; refresh(); });
      kindBtns[k] = bt;
      kindSeg.append(bt);
    }
    if (finMe.canInvoice) f.append(kindSeg);

    const budget = select("Budget", budgets.map((b) => [String(b.id), b.is_reserve ? "Reserve" : `${b.name}${b.division_name ? ` · ${b.division_name}` : ""}`]), undefined, "db-input");
    budget.id = "fc-budget";
    const category = select("Category", [], undefined, "db-input");
    category.id = "fc-category";
    const fillCategories = () => {
      const bud = budgets.find((x) => String(x.id) === budget.value);
      category.replaceChildren(new Option("Choose a category", ""));
      for (const [g, label] of Object.entries(finMe.groups)) {
        const inG = (bud ? bud.categories : []).filter((k) => k.grp === g);
        if (!inG.length) continue;
        const og = document.createElement("optgroup");
        og.label = label;
        og.append(...inG.map((k) => new Option(k.name, String(k.id))));
        category.append(og);
      }
    };
    budget.addEventListener("change", fillCategories);
    fillCategories();
    const description = el("textarea", "db-input");
    description.id = "fc-description";
    description.rows = 2;
    const amount = input("fc-amount", "text", { inputMode: "decimal", placeholder: "0.00" });
    const expenseDate = input("fc-date", "date", { max: todaySG() });
    const vendor = input("fc-vendor");
    const dueDate = input("fc-due", "date");
    const dateField = field("Purchase date", expenseDate, "When you paid. Not in the future.");
    const vendorField = field("Vendor", vendor, "Who Normal is paying.");
    const dueField = field("Due date", dueDate, "From the invoice, if it has one.");
    f.append(field("Budget", budget), field("Category", category), field("What was it for?", description, "e.g. Venue deposit for Youth Day 27", true),
      field("Amount (S$)", amount), dateField, vendorField, dueField);

    // receipts
    const files = [];
    const fileInput = input("fc-files", "file", { multiple: true, accept: "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf" });
    const fileList = el("ul", "db-files");
    const renderFiles = () => fileList.replaceChildren(...files.map((x, i) => {
      const li = el("li");
      const rm = el("button", "db-link", x.uploading ? "uploading…" : "remove");
      rm.type = "button";
      rm.disabled = Boolean(x.uploading);
      rm.addEventListener("click", () => { files.splice(i, 1); renderFiles(); });
      li.append(el("span", "", x.name), el("span", "muted", x.size ? `${Math.ceil(x.size / 1024)} KB` : ""), rm);
      if (x.error) li.append(el("span", "db-error", x.error));
      return li;
    }));
    fileInput.addEventListener("change", async () => {
      for (const file of [...fileInput.files]) {
        if (files.length >= 5) { fail("Up to 5 files per claim."); break; }
        const entry = { name: file.name, uploading: true };
        files.push(entry);
        renderFiles();
        const prep = await fileToUpload(file);
        if (prep.blob.size > 3.5 * 1024 * 1024) { entry.uploading = false; entry.error = FIN_ERRORS.file_too_big; renderFiles(); continue; }
        const r = await finApi({ action: "upload", name: prep.name, type: prep.type, data: await toBase64(prep.blob) });
        entry.uploading = false;
        if (r && r.ok) Object.assign(entry, { id: r.data.id, name: r.data.name, size: r.data.size });
        else entry.error = finErr(r, "Couldn't upload that file.");
        renderFiles();
      }
      fileInput.value = "";
    });
    const filesWrap = field("Receipts or invoices", fileInput, "Photos or PDFs, up to 5. Each must show the shop or vendor, the date, what was bought and the total.", true);
    filesWrap.append(fileList);
    f.append(filesWrap);

    // payout
    const payBox = el("div", "db-field db-field--wide db-payout");
    payBox.append(el("p", "db-label", "How should Finance pay?"));
    const useSaved = el("label", "db-check");
    const useSavedBox = input("fc-use-saved", "checkbox");
    useSaved.append(useSavedBox, finMe.saved ? `Use my saved details (${finMe.saved.payout_masked})` : "");
    useSavedBox.checked = Boolean(finMe.saved);
    const payType = select("Payout method", [["paynow_mobile", "PayNow (mobile number)"], ["paynow_uen", "PayNow (UEN)"], ["bank", "Bank transfer"]], undefined, "db-input");
    payType.id = "fc-paytype";
    const payName = input("fc-payname");
    const payProxy = input("fc-proxy", "text", { inputMode: "tel" });
    const payBank = input("fc-bankname");
    const payAcct = input("fc-acct", "text", { inputMode: "numeric" });
    const remember = el("label", "db-check");
    const rememberBox = input("fc-remember", "checkbox");
    remember.append(rememberBox, "Remember these details for my next claim");
    const newPay = el("div", "db-form db-form--inner");
    const proxyField = field("Mobile number or UEN", payProxy);
    const bankField = field("Bank", payBank, "e.g. DBS");
    const acctField = field("Account number", payAcct);
    newPay.append(field("Payout method", payType), field("Account holder's name", payName), proxyField, bankField, acctField);
    payBox.append(useSaved, newPay, remember);
    f.append(payBox);

    // the declaration, with Finance's notices
    const rulesBox = el("div", "db-field db-field--wide db-rules");
    const agree = el("label", "db-check");
    const agreeBox = input("fc-agree", "checkbox");
    agree.append(agreeBox, "I declare that this claim is true and complete, that I haven't claimed it before, and that the documents attached are genuine.");
    f.append(rulesBox);

    const status = el("p", "db-error");
    const bar = el("div", "db-formbar");
    const go = el("button", "db-btn db-btn--primary", "Send claim");
    go.type = "submit";
    go.id = "fc-submit";
    bar.append(go, linkButton("Cancel", "#/fin/claims"));
    f.append(status, bar);

    function refresh() {
      Object.entries(kindBtns).forEach(([k, bt]) => (k === kind ? bt.setAttribute("aria-current", "page") : bt.removeAttribute("aria-current")));
      dateField.hidden = kind !== "reimbursement";
      vendorField.hidden = dueField.hidden = kind !== "invoice";
      useSaved.hidden = !finMe.saved || kind === "invoice";
      const saved = !useSaved.hidden && useSavedBox.checked;
      newPay.hidden = saved;
      remember.hidden = saved || kind === "invoice";
      proxyField.hidden = payType.value === "bank";
      bankField.hidden = acctField.hidden = payType.value !== "bank";
      $("label", proxyField).textContent = payType.value === "paynow_uen" ? "UEN" : "Mobile number (registered with PayNow)";
      const rules = finMe.rules.filter((r) => r.applies_to === "all" || r.applies_to === kind);
      rulesBox.replaceChildren(el("p", "db-label", "Declaration"), ...rules.map((r) => {
        const d = el("div", "db-rule");
        d.append(el("strong", "", r.title), el("p", "db-notes", r.body));
        if (r.link_url) { const a = finLink(r.link_label || r.link_url, r.link_url); a.target = "_blank"; a.rel = "noopener"; d.append(a); }
        return d;
      }), agree);
    }
    [useSavedBox, payType].forEach((x) => x.addEventListener("change", refresh));
    refresh();

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      if (files.some((x) => x.uploading)) { status.textContent = "Wait for the receipts to finish uploading."; return; }
      const saved = !useSaved.hidden && useSavedBox.checked;
      const payload = {
        action: "submit", submissionId, kind, budgetId: budget.value, categoryId: category.value, description: description.value, amount: amount.value,
        expenseDate: expenseDate.value, vendorName: vendor.value, dueDate: dueDate.value, fileIds: files.filter((x) => x.id).map((x) => x.id),
        agreed: agreeBox.checked, savePayout: rememberBox.checked,
        payout: saved ? { type: "saved" } : { type: payType.value, name: payName.value, proxy: payProxy.value, bankName: payBank.value, accountNumber: payAcct.value },
      };
      if (!payload.categoryId) { status.textContent = "Choose a category."; return; }
      go.disabled = true;
      const r = await finApi(payload);
      go.disabled = false;
      if (!r || !r.ok) { status.textContent = finErr(r); return; }
      listKey = null;
      toast(`${r.data.code} sent. ${r.data.status === "pending_review" ? "A lead of the division reviews it first." : "Finance reviews it next."}`);
      location.hash = `#/fin/c/${r.data.id}`;
    });
    body.append(panel("claim", f));
  }

  /* one claim */
  async function claimPage(id) {
    fail("");
    const r = await finGet({ view: "claim", id });
    if (!r) return;
    if (!r.ok) { detail("#/fin/claims", "claims", "", "not found"); return fail(r.status === 404 ? "That claim isn't there, or you can't see it." : finErr(r)); }
    const { claim: c, files, canDecide, canPay } = r.data;
    const back = canDecide ? "#/fin/claims/review" : Number(c.claimant_id) === me.memberId ? "#/fin/claims" : "#/fin/claims/all";
    const body = detail(back, "claims", c.code, c.description, [claimPill(c), c.kind === "invoice" ? "vendor invoice" : "reimbursement"]);
    const { main, aside } = recordLayout(body);
    if (c.status === "rejected" && c.rejection_reason) main.append(el("p", "db-alert", `Rejected: ${c.rejection_reason}`));
    if (r.data.budget_available_cents !== undefined && r.data.budget_available_cents < 0) {
      main.append(el("p", "db-alert db-alert--warn", `Heads up: after this claim the budget is ${cents(-r.data.budget_available_cents)} short of its funding. A short balance doesn't block a claim.`));
    }
    main.append(panel("details", fields([
      ["Amount", cents(c.amount_cents)],
      ["Claimant", c.claimant_name, `#/m/${c.claimant_id}`],
      ["Budget", c.budget_name, finMe.finance || finMe.isLead ? `#/fin/b/${c.budget_id}` : null],
      ["Category", c.category_name],
      ["Division", c.division_name || (c.division_id === null ? "Reserve" : "")],
      ...(c.kind === "invoice" ? [["Vendor", c.vendor_name || ""], ["Due", c.due_date ? day(c.due_date) : ""]] : [["Purchase date", c.expense_date ? day(c.expense_date) : ""]]),
      ["Paid to", c.payout_type ? `${({ paynow_mobile: "PayNow", paynow_uen: "PayNow", bank: "Bank" })[c.payout_type]} · ${c.payout_masked}` : "not recorded"],
      ["Submitted", when(c.created_at)],
      ...(c.status === "paid" ? [["Disbursed", day(c.paid_on)], ["Reference", c.payment_reference || ""]] : []),
    ])));
    if (Array.isArray(c.items) && c.items.length) {
      const t = el("table", "db-table");
      const th = el("thead"), tb = el("tbody");
      renderTable(th, tb, [
        { label: "Item", cell: (i) => i.description },
        { label: "Category", cell: (i) => i.category_name || "" },
        { label: "Amount", cls: "is-right", cell: (i) => (i.amount_cents === null || i.amount_cents === undefined ? "" : cents(i.amount_cents)) },
      ], c.items);
      t.append(th, tb);
      const sc = el("div", "db-scroll");
      sc.append(t);
      main.append(panel(`items (${c.items.length})`, sc));
    }

    const fl = el("ul", "db-files db-files--thumbs");
    for (const x of files) {
      const li = el("li");
      const href = `/api/admin/finance?view=file&id=${x.id}`;
      const a = finLink(x.name, href);
      a.target = "_blank";
      a.rel = "noopener";
      if (/^image\/(jpeg|png|webp)$/.test(x.type)) {
        const img = el("img", "db-thumb");
        img.src = href;
        img.alt = x.name;
        img.loading = "lazy";
        const t = finLink("", href);
        t.target = "_blank";
        t.rel = "noopener";
        t.append(img);
        li.append(t);
      }
      li.append(a, el("span", "muted", `${Math.ceil(x.size / 1024)} KB`));
      fl.append(li);
    }
    main.append(panel(`receipts (${files.length})`, files.length ? fl : el("p", "db-note", "No files.")));

    if (canDecide) {
      const box = el("div", "db-stack");
      const reason = el("textarea", "db-input");
      reason.id = "fc-reason";
      reason.rows = 2;
      reason.placeholder = "If rejecting: what should the claimant fix?";
      const err = el("p", "db-error");
      const decide = async (approve) => {
        err.textContent = "";
        const s = await finApi({ action: "decide", id: c.id, approve, reason: reason.value });
        if (!s || !s.ok) { err.textContent = finErr(s); return; }
        listKey = null;
        toast(approve ? (c.status === "pending_review" ? "Reviewed: it goes to Finance now." : "Approved: it's ready to disburse.") : "Rejected. The claimant sees your reason.");
        claimPage(String(c.id));
      };
      const row = el("div", "db-actions");
      row.append(
        button(c.status === "pending_review" ? "Approve → send to Finance" : "Approve", "primary", () => decide(true), "fc-approve"),
        button("Reject", "danger", () => decide(false), "fc-reject"),
      );
      box.append(el("p", "db-note", c.status === "pending_review" ? "You're reviewing this as a lead of its division. Finance gives the final approval." : "Final approval. Once approved, it's ready to disburse."), reason, err, row);
      main.append(panel("your decision", box));
    }

    if (canPay) {
      const p = el("div", "db-stack");
      const pr = await finGet({ view: "payout", id: c.id });
      const bk = await finGet({ view: "bank" });
      if (pr && pr.ok) {
        const d = pr.data.details;
        const info = fields([
          ["Pay", cents(c.amount_cents)],
          ["To", d.name],
          ...(d.type === "bank" ? [["Bank", d.bankName], ["Account", d.accountNumber]] : [[d.type === "paynow_uen" ? "UEN" : "PayNow mobile", d.proxy]]),
          ["Reference", pr.data.reference],
        ]);
        p.append(info);
        if (pr.data.qr) {
          const img = el("img", "db-qr");
          img.alt = "PayNow QR code";
          img.src = `data:image/svg+xml;base64,${btoa(pr.data.qr)}`;
          p.append(img, el("p", "db-note", "Scan with your banking app: the payee, amount and reference are filled in. Confirm the transfer there, then record it below."));
        }
      } else p.append(el("p", "db-alert", finErr(pr, "Couldn't read the payout details.")));
      const accounts = bk && bk.ok ? bk.data.accounts.filter((a) => a.active) : [];
      if (!accounts.length) p.append(el("p", "db-alert", "Add a bank account on the Bank page first."));
      const acc = select("Paid from", accounts.map((a) => [String(a.id), `${a.name} ••${a.last4}`]), undefined, "db-input");
      acc.id = "fc-account";
      const ref = el("input", "db-input");
      ref.id = "fc-ref";
      ref.placeholder = "Bank transaction reference";
      const dt = el("input", "db-input");
      dt.type = "date";
      dt.id = "fc-paid-on";
      dt.value = todaySG();
      dt.max = todaySG();
      const err = el("p", "db-error");
      const rec = button("Record disbursement", "primary", async () => {
        err.textContent = "";
        const s = await finApi({ action: "pay", id: c.id, accountId: acc.value, reference: ref.value, date: dt.value });
        if (!s || !s.ok) { err.textContent = finErr(s); return; }
        listKey = null;
        toast(c.kind === "invoice" ? "Settled." : "Reimbursed.");
        claimPage(String(c.id));
      }, "fc-pay");
      const grid = el("div", "db-form");
      const lab = (t, i) => { const w = el("div", "db-field"); const l = el("label", "db-label", t); l.htmlFor = i.id; w.append(l, i); return w; };
      grid.append(lab("Paid from", acc), lab("Bank reference", ref), lab("Date", dt));
      p.append(grid, err, rec);
      main.append(panel("disburse", p));
    }
    main.append(timelinePanel("claim", c.id));
    aside.append(panel("claim", fields([["Claim", c.code], ["Status", c.status_label], ["Last change", when(c.updated_at)]], true)));
  }

  /* budgets */
  function budgetsList() {
    openList("fin:budgets", () => {
      $("#list-title").textContent = "budgets";
      filterInputs([]);
      if (finMe.finance) $("#list-actions").append(linkButton("+ new budget", "#/fin/b/new", "primary"));
      const columns = [
        { label: "Budget", cls: "is-name", link: true, cell: (b) => (b.is_reserve ? "Reserve" : b.name) },
        { label: "Division", cell: (b) => (b.is_reserve ? "outside every division" : b.division_name || "—") },
        { label: "Guidelines", cls: "is-right", cell: (b) => (b.is_reserve ? "" : cents(b.guideline_cents)) },
        { label: "Pending", cls: "is-right", cell: (b) => cents(b.pending_cents) },
        { label: "Approved", cls: "is-right", cell: (b) => cents(b.approved_cents) },
        { label: "Disbursed", cls: "is-right", cell: (b) => cents(b.paid_cents) },
        { label: "Available", cls: "is-right", cell: (b) => el("span", b.available_cents < 0 ? "is-overdue" : "", cents(b.available_cents)) },
        { label: "Status", cell: (b) => pill(b.active ? "open" : "closed", b.active ? "active" : "disabled") },
      ];
      loadRows = async () => {
        const run = ++listRun;
        fail("");
        const r = await finGet({ view: "budgets" });
        if (run !== listRun) return;
        if (!r || !r.ok) return fail(finErr(r, "Couldn't load budgets."));
        const rows = r.data.budgets.filter((b) => b.figures);
        fillList(columns, rows, (b) => `#/fin/b/${b.id}`, rows.length, finMe.finance ? "No budgets yet. Add one with \"+ new budget\"." : "No budgets in your divisions yet.", "",
          "Available = grants received + loans from the reserve − repayments − approved and disbursed claims.");
      };
    });
  }

  async function budgetPage(id) {
    fail("");
    const isNew = id === "new";
    let d = null;
    if (!isNew) {
      const r = await finGet({ view: "budget", id });
      if (!r) return;
      if (!r.ok) { detail("#/fin/budgets", "budgets", "", "not found"); return fail(finErr(r)); }
      d = r.data;
    }
    const b = d ? d.budget : { name: "", kind: "event", division_id: null, active: true, grant_committed_cents: 0 };
    const body = detail("#/fin/budgets", "budgets", isNew ? "new" : `B-${String(b.id).padStart(4, "0")}`, isNew ? "new budget" : b.is_reserve ? "Reserve" : b.name,
      isNew ? [] : [pill(b.active ? "open" : "closed", b.active ? "active" : "disabled"), b.is_reserve ? "outside every division" : [b.division_name, b.kind].filter(Boolean).join(" · ")]);
    const stack = el("div", "db-stack-page");
    body.append(stack);

    if (d) {
      const tile = (n, label, sub, warn) => { const t = el("div", `db-stat${warn ? " is-warn" : ""}`); t.append(el("span", "db-stat__n", n), el("span", "db-stat__l", label)); if (sub) t.append(el("span", "db-stat__s", sub)); return t; };
      const tiles = el("div", "db-stats");
      if (b.is_reserve) {
        tiles.append(tile(cents(b.funded_cents), "added to the reserve"), tile(cents(b.lent_out_cents), "lent out to budgets"), tile(cents(b.approved_cents + b.paid_cents), "claimed against it"),
          tile(cents(b.available_cents), "available", "", b.available_cents < 0));
      } else {
        tiles.append(
          tile(cents(b.guideline_cents), "guidelines"),
          tile(cents(b.approved_cents + b.paid_cents), "approved + disbursed", b.pending_cents ? `${cents(b.pending_cents)} pending` : ""),
          tile(cents(b.granted_cents), "grants received", b.grant_committed_cents ? `of ${cents(b.grant_committed_cents)} committed` : ""),
          tile(cents(b.loaned_cents - b.repaid_cents), "owed to the reserve"),
          tile(cents(b.available_cents), "available", "", b.available_cents < 0),
        );
      }
      stack.append(tiles);

      if (!b.is_reserve) {
        const t = el("table", "db-table");
        const th = el("thead"), tb = el("tbody");
        renderTable(th, tb, [
          { label: "Category", cls: "is-name", cell: (g) => g.name },
          { label: "Group", cls: "is-muted", cell: (g) => d.groups[g.grp] || "" },
          { label: "Guideline", cls: "is-right", cell: (g) => cents(g.guideline_cents) },
          { label: "Pending", cls: "is-right", cell: (g) => cents(g.pending_cents) },
          { label: "Approved", cls: "is-right", cell: (g) => cents(g.approved_cents) },
          { label: "Disbursed", cls: "is-right", cell: (g) => cents(g.paid_cents) },
          { label: "Used", cell: (g) => {
            const used = g.approved_cents + g.paid_cents;
            const pct = g.guideline_cents ? Math.min(100, Math.round((used / g.guideline_cents) * 100)) : used ? 100 : 0;
            const bar = el("span", `db-bar${used > g.guideline_cents ? " is-over" : ""}`);
            const fill = el("span", "db-bar__fill");
            fill.style.width = `${pct}%`;
            bar.append(fill);
            const w = el("span", "db-bar-wrap");
            w.append(bar, el("span", "muted", g.guideline_cents ? `${Math.round((used / g.guideline_cents) * 100)}%` : ""));
            return w;
          } },
        ], d.guidelines);
        t.append(th, tb);
        const sc = el("div", "db-scroll");
        sc.append(t);
        const p = panel("spending against each guideline", null);
        p.append(sc);
        stack.append(p);
      }

      // funding
      const fundsUl = el("ul", "db-mini");
      const KIND = { grant: "Grant received", loan: "Loan from the reserve", repayment: "Repaid to the reserve", addition: "Added to the reserve" };
      for (const x of d.funds) {
        const li = el("li");
        li.append(el("span", "", KIND[x.kind]), el("span", "muted", [day(x.entry_date), x.note, x.actor].filter(Boolean).join(" · ")), el("span", x.kind === "repayment" ? "is-overdue" : "", `${x.kind === "repayment" ? "−" : "+"}${cents(x.amount_cents)}`));
        fundsUl.append(li);
      }
      if (!d.funds.length) fundsUl.append(el("li", "db-note", "Nothing recorded yet."));
      const fundPanel = panel(b.is_reserve ? "additions" : "funding", fundsUl);
      if (d.finance) {
        const forms = el("div", "db-fund-forms");
        const mini = (title, idp, fieldsList, submitText, action, extra = () => ({})) => {
          const fbox = el("form", "db-mini-form");
          fbox.noValidate = true;
          fbox.append(el("p", "db-label", title));
          const inputs = {};
          for (const [k, label, type, opts] of fieldsList) {
            let i;
            if (type === "select") i = select(label, opts, undefined, "db-input");
            else { i = el("input", "db-input"); i.type = type; i.placeholder = label; if (type === "date") { i.value = todaySG(); i.max = todaySG(); } }
            i.id = `${idp}-${k}`;
            i.setAttribute("aria-label", label);
            inputs[k] = i;
            fbox.append(i);
          }
          const err = el("p", "db-error");
          const go = el("button", "db-btn db-btn--sm", submitText);
          go.type = "submit";
          go.id = `${idp}-go`;
          fbox.append(err, go);
          fbox.addEventListener("submit", async (e) => {
            e.preventDefault();
            err.textContent = "";
            const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
            const s = await finApi({ action, budgetId: b.id, ...vals, ...extra() });
            if (!s || !s.ok) { err.textContent = finErr(s) + (s && s.data && s.data.available_cents !== undefined ? ` (${cents(s.data.available_cents)} available)` : s && s.data && s.data.owed_cents !== undefined ? ` (owes ${cents(s.data.owed_cents)})` : ""); return; }
            toast("Recorded.");
            listKey = null;
            budgetPage(String(b.id));
          });
          return fbox;
        };
        if (b.is_reserve) {
          forms.append(mini("Add to the reserve", "rs", [["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "What is it?", "text"]], "Add", "reserve-add"));
        } else {
          const accts = (d.accounts || []).map((a) => [String(a.id), `${a.name} ••${a.last4}`]);
          forms.append(
            mini("Grant received", "gr", [["accountId", "Into account", "select", accts.length ? accts : [["", "Add a bank account first"]]], ["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "Note", "text"]], "Record grant", "grant"),
            mini("Loan from the reserve", "ln", [["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "Note", "text"]], "Lend", "loan"),
            mini("Repay the reserve", "rp", [["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "Note", "text"]], "Repay", "repay"),
          );
        }
        fundPanel.append(forms);
      }
      stack.append(fundPanel);

      const cl = await finGet({ view: "claims", scope: "budget", budget: String(b.id) });
      if (cl && cl.ok) {
        const ul = el("ul", "db-mini");
        for (const c of cl.data.claims.slice(0, 15)) {
          const li = el("li");
          li.append(el("span", "mono muted", c.code), finLink(c.description, `#/fin/c/${c.id}`), el("span", "muted", `${c.claimant_name} · ${c.category_name}`), claimPill(c), el("span", "", cents(c.amount_cents)));
          ul.append(li);
        }
        if (!cl.data.claims.length) ul.append(el("li", "db-note", "No claims yet."));
        stack.append(panel(`claims (${cl.data.claims.length})`, ul));
      }
    }

    // setting it up (Finance)
    if ((isNew || d.finance) && !(d && d.budget.is_reserve)) {
      if (isNew) await loadFinMe();
      const cats = d ? d.allCategories : (await finGet({ view: "setup" }))?.data?.categories?.filter((k) => k.active).map((k) => ({ ...k, provided: false, guideline_cents: 0 })) || [];
      const f = el("form", "db-form");
      f.noValidate = true;
      const field = (label, input) => { const w = el("div", "db-field"); const l = el("label", "db-label", label); l.htmlFor = input.id; w.append(l, input); return w; };
      const name = el("input", "db-input"); name.id = "fb-name"; name.value = b.name || "";
      const kind = select("Kind", [["event", "Event"], ["general", "General (running costs)"]], b.kind, "db-input"); kind.id = "fb-kind";
      const div = select("Division", [["", "Choose a division"], ...finMe.divisions.map((x) => [String(x.id), x.name])], b.division_id ? String(b.division_id) : "", "db-input"); div.id = "fb-division";
      const committed = el("input", "db-input"); committed.id = "fb-committed"; committed.inputMode = "decimal"; committed.value = b.grant_committed_cents ? (b.grant_committed_cents / 100).toFixed(2) : "";
      const activeL = el("label", "db-check"); const active = el("input"); active.type = "checkbox"; active.id = "fb-active"; active.checked = b.active !== false; activeL.append(active, "Open for claims");
      f.append(field("Name", name), field("Kind", kind), field("Division", div), field("Grant committed (S$)", committed));
      const aw = el("div", "db-field"); aw.append(activeL); f.append(aw);
      const gl = el("div", "db-field db-field--wide");
      gl.append(el("p", "db-label", "Categories it provides, with a guideline amount each"));
      const grid = el("div", "db-guidelines");
      const rows = [];
      for (const [g, label] of Object.entries(finMe.groups)) {
        const inG = cats.filter((k) => k.grp === g);
        if (!inG.length) continue;
        grid.append(el("p", "db-guidelines__group", label));
        for (const k of inG) {
          const r = el("div", "db-guidelines__row");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = Boolean(k.provided); cb.id = `fb-cat-${k.id}`;
          const lab = el("label", "", k.name); lab.htmlFor = cb.id;
          const amt = el("input", "db-input"); amt.inputMode = "decimal"; amt.placeholder = "0.00"; amt.value = k.guideline_cents ? (k.guideline_cents / 100).toFixed(2) : ""; amt.id = `fb-amt-${k.id}`;
          amt.setAttribute("aria-label", `Guideline for ${k.name}`);
          amt.addEventListener("input", () => { if (amt.value) cb.checked = true; });
          r.append(cb, lab, amt);
          grid.append(r);
          rows.push({ id: k.id, cb, amt });
        }
      }
      gl.append(grid);
      f.append(gl);
      const err = el("p", "db-error");
      const bar = el("div", "db-formbar");
      const go = el("button", "db-btn db-btn--primary", isNew ? "Create budget" : "Save budget"); go.type = "submit"; go.id = "fb-save";
      bar.append(go);
      f.append(err, bar);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.textContent = "";
        const s = await finApi({ action: "budget", id: isNew ? undefined : b.id, name: name.value, kind: kind.value, divisionId: div.value, committed: committed.value, active: active.checked,
          guidelines: rows.filter((x) => x.cb.checked).map((x) => ({ categoryId: x.id, amount: x.amt.value })) });
        if (!s || !s.ok) { err.textContent = finErr(s); return; }
        listKey = null;
        toast("Budget saved.");
        if (isNew) location.hash = `#/fin/b/${s.data.id}`; else budgetPage(String(b.id));
      });
      if (!finMe.divisions.length) stack.append(el("p", "db-alert", "Budgets live in a division: add divisions on the org chart first."));
      stack.append(panel(isNew ? "budget" : "set up", f));
    }
    if (d) stack.append(timelinePanel("budget", b.id));
  }

  /* disbursements (Finance) */
  function payoutsList() {
    openList("fin:payouts", () => {
      $("#list-title").textContent = "disbursements";
      filterInputs([]);
      $("#list-actions").append(button("Export CSV", "", () => download("/api/admin/finance?view=export")));
      const columns = [
        { label: "ID", cls: "is-id", cell: (c) => c.code },
        { label: "Approved", cls: "is-muted", cell: (c) => when(c.updated_at) },
        { label: "Pay", cell: (c) => c.kind === "invoice" ? `${c.vendor_name} (invoice)` : c.claimant_name },
        { label: "What for", cls: "is-name", link: true, cell: (c) => c.description },
        { label: "Via", cell: (c) => c.payout_masked },
        { label: "Amount", cls: "is-right", cell: (c) => cents(c.amount_cents) },
      ];
      loadRows = async () => {
        const run = ++listRun;
        fail("");
        const r = await finGet({ view: "claims", scope: "disburse" });
        if (run !== listRun) return;
        if (!r || !r.ok) return fail(finErr(r, "Couldn't load disbursements."));
        const total = r.data.claims.reduce((s, c) => s + c.amount_cents, 0);
        fillList(columns, r.data.claims, (c) => `#/fin/c/${c.id}`, r.data.claims.length, "Nothing approved and waiting. Approved claims appear here to pay.", "",
          r.data.claims.length ? `To disburse: ${cents(total)}` : "");
      };
    });
  }

  /* bank (Finance) */
  async function bankPage() {
    fail("");
    const prev = $("#bank-account-filter");
    const picked = prev ? prev.value : "";
    const body = detail("#/", "home", "", "bank");
    const r = await finGet({ view: "bank", account: picked });
    if (!r || !r.ok) return fail(finErr(r, "Couldn't load the bank."));
    const { accounts, entries } = r.data;
    const cards = el("div", "db-stats");
    for (const a of accounts) {
      const c = el("div", `db-stat db-bank${a.active ? "" : " is-closed"}`);
      c.append(el("span", "db-stat__l", `${a.name} · ${a.bank} ••${a.last4}${a.active ? "" : " (closed)"}`), el("span", "db-stat__n", cents(a.balance_cents)), el("span", "db-stat__s", "expected balance"));
      if (a.active) {
        const dbs = el("input", "db-input");
        dbs.placeholder = "DBS balance";
        dbs.inputMode = "decimal";
        dbs.setAttribute("aria-label", `Balance in the bank for ${a.name}`);
        dbs.id = `bank-dbs-${a.id}`;
        const out = el("span", "db-stat__s");
        const fix = button("Match it", "", async () => {
          const typed = Math.round(Number(dbs.value.replace(/[$,\s]/g, "")) * 100);
          const diff = typed - a.balance_cents;
          const s = await finApi({ action: "entry", kind: "adjustment", accountId: a.id, amount: (diff < 0 ? "-" : "") + (Math.abs(diff) / 100).toFixed(2), note: "Matched to the DBS balance", expectedBalance: a.balance_cents });
          if (!s || !s.ok) return fail(finErr(s));
          toast("Adjusted to match.");
          bankPage();
        });
        fix.classList.add("db-btn--sm");
        fix.hidden = true;
        dbs.addEventListener("input", () => {
          const typed = Math.round(Number(dbs.value.replace(/[$,\s]/g, "")) * 100);
          if (!dbs.value || !Number.isFinite(typed)) { out.textContent = ""; fix.hidden = true; return; }
          const diff = typed - a.balance_cents;
          out.textContent = diff === 0 ? "✓ matches" : `${diff > 0 ? "bank has " + cents(diff) + " more" : "bank has " + cents(-diff) + " less"}`;
          fix.hidden = diff === 0;
        });
        c.append(dbs, out, fix);
      }
      cards.append(c);
    }
    if (!accounts.length) cards.append(el("p", "db-empty", "No bank accounts yet. Add one below with its opening balance."));
    body.append(cards);

    const open = accounts.filter((a) => a.active).map((a) => [String(a.id), `${a.name} ••${a.last4}`]);
    const forms = el("div", "db-fund-forms");
    const mini = (title, idp, list, text, action, extra = {}) => {
      const f = el("form", "db-mini-form");
      f.noValidate = true;
      f.append(el("p", "db-label", title));
      const inputs = {};
      for (const [k, label, type, opts] of list) {
        let i;
        if (type === "select") i = select(label, opts.length ? opts : [["", "Add an account first"]], undefined, "db-input");
        else { i = el("input", "db-input"); i.type = type; i.placeholder = label; if (type === "date") { i.value = todaySG(); i.max = todaySG(); } }
        i.id = `${idp}-${k}`;
        i.setAttribute("aria-label", label);
        inputs[k] = i;
        f.append(i);
      }
      const err = el("p", "db-error");
      const go = el("button", "db-btn db-btn--sm", text);
      go.type = "submit";
      go.id = `${idp}-go`;
      f.append(err, go);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.textContent = "";
        const s = await finApi({ action, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])), ...extra });
        if (!s || !s.ok) { err.textContent = finErr(s); return; }
        toast("Recorded.");
        bankPage();
      });
      return f;
    };
    forms.append(
      mini("Add an account", "ba", [["name", "Name, e.g. DBS current", "text"], ["bank", "Bank (DBS)", "text"], ["last4", "Last 4 digits", "text"], ["opening", "Opening balance (S$)", "text"], ["date", "As of", "date"]], "Add account", "account"),
      mini("Money in (grant or other income)", "bi", [["accountId", "Account", "select", open], ["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "What is it?", "text"]], "Record", "entry", { kind: "grant" }),
      mini("Adjustment (use − for money out)", "bj", [["accountId", "Account", "select", open], ["amount", "Amount (S$), e.g. -12.50", "text"], ["date", "Date", "date"], ["note", "Why?", "text"]], "Record", "entry", { kind: "adjustment" }),
      mini("Transfer between accounts", "bt", [["from", "From", "select", open], ["to", "To", "select", open], ["amount", "Amount (S$)", "text"], ["date", "Date", "date"], ["note", "Note", "text"]], "Transfer", "transfer"),
    );
    body.append(panel("record", forms));

    const filter = select("Account", [["", "All accounts"], ...accounts.map((a) => [String(a.id), `${a.name} ••${a.last4}`])], picked, "db-select");
    filter.id = "bank-account-filter";
    filter.addEventListener("change", () => bankPage());
    const KIND = { opening: "Opening balance", grant: "Money in", payout: "Disbursement", adjustment: "Adjustment", transfer_in: "Transfer in", transfer_out: "Transfer out" };
    const name = new Map(accounts.map((a) => [a.id, `${a.name} ••${a.last4}`]));
    const t = el("table", "db-table");
    const th = el("thead"), tb = el("tbody");
    renderTable(th, tb, [
      { label: "Date", cls: "is-nowrap", cell: (e) => day(e.entry_date) },
      { label: "Account", cell: (e) => name.get(e.account_id) },
      { label: "Kind", cell: (e) => KIND[e.kind] },
      { label: "Note", cls: "is-wide", cell: (e) => (e.claim_id ? [finLink(e.claim_code, `#/fin/c/${e.claim_id}`), ` ${e.note || ""}`] : e.note) },
      { label: "Amount", cls: "is-right", cell: (e) => el("span", e.amount_cents < 0 ? "is-overdue" : "", `${e.amount_cents < 0 ? "−" : "+"}${cents(Math.abs(e.amount_cents))}`) },
      { label: "By", cls: "is-muted", cell: (e) => e.actor },
    ], entries);
    t.append(th, tb);
    const sc = el("div", "db-scroll");
    sc.append(t);
    const ledger = panel("ledger", null, [filter]);
    ledger.append(sc);
    if (!entries.length) ledger.append(el("p", "db-empty", "No entries yet."));
    body.append(ledger);
    const closeBox = el("div", "db-actions");
    for (const a of accounts) {
      closeBox.append(button(a.active ? `Close ${a.name}` : `Reopen ${a.name}`, "", async () => {
        const s = await finApi({ action: "account-close", id: a.id, active: !a.active });
        if (s && s.ok) bankPage(); else fail(finErr(s));
      }));
    }
    if (accounts.length) body.append(panel("accounts", [el("p", "db-note", "Entries are never edited or deleted: correct a mistake with an adjustment, so the ledger always explains the balance."), closeBox]));
  }

  /* setup (Finance) */
  async function finSetupPage() {
    fail("");
    const body = detail("#/", "home", "", "finance setup");
    const r = await finGet({ view: "setup" });
    if (!r || !r.ok) return fail(finErr(r));
    const { categories, rules, groups, keyReady } = r.data;
    body.append(el("p", keyReady ? "db-note" : "db-alert", keyReady
      ? "Payout details are encrypted (PAYOUT_ENCRYPTION_KEY is set). Who's on the Finance team is set on each login in accounts; division leads come from the org chart (Founder, Chief of Staff or Director seats on a division)."
      : FIN_ERRORS.payout_key));
    const justImported = Boolean(importDone);
    const importBox = r.data.import ? importPanel(r.data.import) : null;
    if (importBox && (!r.data.import.last || justImported)) body.append(importBox);

    // categories
    const t = el("table", "db-table");
    const th = el("thead"), tb = el("tbody");
    const groupSel = (v) => select("Group", Object.entries(groups), v, "db-select");
    renderTable(th, tb, [
      { label: "Category", cell: (k) => { const i = el("input", "db-input"); i.value = k.name; i.dataset.k = "name"; i.setAttribute("aria-label", "Category name"); return i; } },
      { label: "Group", cell: (k) => { const s = groupSel(k.grp); s.dataset.k = "group"; return s; } },
      { label: "In use", cell: (k) => { const l = el("label", "db-check"); const c = el("input"); c.type = "checkbox"; c.checked = k.active; c.dataset.k = "active"; l.append(c, "active"); return l; } },
      { label: "", cls: "is-right", cell: (k) => button("Save", "", async (e) => {
        const tr = e.target.closest("tr");
        const v = (x) => $(`[data-k=${x}]`, tr);
        const s = await finApi({ action: "category", id: k.id, name: v("name").value, group: v("group").value, active: v("active").checked });
        if (s && s.ok) toast("Saved."); else fail(finErr(s));
      }) },
    ], categories);
    t.append(th, tb);
    const sc = el("div", "db-scroll");
    sc.append(t);
    const addName = el("input", "db-input"); addName.placeholder = "New category"; addName.id = "fs-cat-name";
    const addGroup = groupSel("operations"); addGroup.id = "fs-cat-group";
    const add = button("Add category", "", async () => {
      const s = await finApi({ action: "category", name: addName.value, group: addGroup.value });
      if (s && s.ok) { toast("Added."); finSetupPage(); } else fail(finErr(s));
    }, "fs-cat-add");
    const addRow = el("div", "db-toolbar");
    addRow.append(addName, addGroup, add);
    const catPanel = panel(`spend categories (${categories.length})`, null);
    catPanel.append(sc, addRow);
    body.append(catPanel);

    // the claim form's notices
    const ruleForm = (x = {}) => {
      const { form: f } = buildForm([
        { key: "title", label: "Title", required: true },
        { key: "appliesTo", label: "Shown on", type: "select", options: [["all", "every claim"], ["reimbursement", "reimbursements"], ["invoice", "vendor invoices"]] },
        { key: "body", label: "Text", type: "textarea", required: true, wide: true },
        { key: "linkLabel", label: "Link text" },
        { key: "linkUrl", label: "Link (https://…)", type: "url" },
        { key: "sort", label: "Order", type: "number" },
        { key: "active", label: "Show it", type: "checkbox" },
      ], { title: x.title, appliesTo: x.applies_to || "all", body: x.body, linkLabel: x.link_label, linkUrl: x.link_url, sort: x.sort || 0, active: x.active !== false }, {
        submit: x.id ? "Save notice" : "Add notice",
        extra: x.id ? [confirmButton("Delete", "", async () => { const s = await finApi({ action: "rule-delete", id: x.id }); if (s && s.ok) finSetupPage(); else fail(finErr(s)); })] : [],
        onSubmit: async (vals, status) => {
          const s = await finApi({ action: "rule", id: x.id, ...vals });
          if (!s || !s.ok) { status.textContent = finErr(s); return; }
          toast("Saved.");
          finSetupPage();
        },
      });
      return f;
    };
    const rulesBox = el("div", "db-stack");
    rulesBox.append(el("p", "db-note", "Shown on the claim form above the declaration people tick. Plain text."));
    for (const x of rules) {
      const det = el("details", "db-rule-edit");
      det.append(el("summary", "", `${x.title}${x.active ? "" : " (hidden)"}`), ruleForm(x));
      rulesBox.append(det);
    }
    const addDet = el("details", "db-rule-edit");
    addDet.append(el("summary", "", "+ add a notice"), ruleForm());
    rulesBox.append(addDet);
    body.append(panel("claim form notices", rulesBox));
    if (importBox && r.data.import.last && !justImported) body.append(importBox);
  }

  // copying the finance app's data in: check (who's who), import, then the receipts a batch at a time
  let importDone = null; // the result, shown once on the refreshed setup page
  const nOf = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  function importPanel(info) {
    const box = el("div", "db-stack");
    box.id = "fin-import";
    const ABOUT = "Copies the finance app's claims (with their receipts and history), budgets and funding, bank ledger, reserve, saved payout details and claim-form notices into the portal.";
    const intro = (error) => {
      box.replaceChildren();
      if (error) box.append(el("p", "db-alert", error));
      if (!info.ready) {
        box.append(el("p", "db-note", `${ABOUT} To switch it on, set FINANCE_SUPABASE_URL and FINANCE_SUPABASE_KEY in Vercel (see the README), then come back here.`));
        return;
      }
      box.append(el("p", "db-note", info.last
        ? `Last imported ${when(info.last.at)} by ${info.last.by}. Running it again copies only what's new in the finance app.`
        : `${ABOUT} First it checks: it reads the finance app and suggests who's who. Nothing is copied until you press Import.`));
      const go = el("div", "db-actions");
      go.append(button("Check the finance app", "primary", checkIt, "fi-check"));
      box.append(go);
    };
    async function checkIt() {
      box.replaceChildren(el("p", "db-note", "Reading the finance app…"));
      const r = await finApi({ action: "import-check" });
      if (!r || !r.ok) return intro(finErr(r, "Couldn't read the finance app."));
      showPlan(r.data);
    }
    const mapTable = (rows, cols) => {
      const t = el("table", "db-table");
      const th = el("thead"), tb = el("tbody");
      renderTable(th, tb, cols, rows);
      t.append(th, tb);
      const sc = el("div", "db-scroll");
      sc.append(t);
      return sc;
    };
    function showPlan(d) {
      box.replaceChildren();
      const k = d.counts;
      if (d.keyOk === false) box.append(el("p", "db-alert", FIN_ERRORS.import_key));
      if (!d.portalKey) box.append(el("p", "db-alert", FIN_ERRORS.payout_key));
      box.append(fields([
        ["Claims", `${k.claims}${d.already ? ` (${d.already} copied before: skipped)` : ""}`],
        ["Receipts", String(k.receipts)],
        ["Claim history", nOf(k.history, "step")],
        ["Budgets", `${k.budgets}, with ${nOf(k.funds, "grant, loan or repayment", "grants, loans and repayments")}`],
        ["Bank", `${nOf(k.bankAccounts, "account")}, ${nOf(k.bankEntries, "ledger entry", "ledger entries")}`],
        ["Reserve", nOf(k.reserveAdditions, "addition")],
        ["Saved payout details", String(k.savedPayouts)],
        ["Claim form notices", String(k.rules)],
      ]));
      const left = [
        ...(d.leftOut.bankEdits ? [`${nOf(d.leftOut.bankEdits, "edit")} to ledger entries: the entries' current amounts are copied, their edit history stays in the finance app.`] : []),
        ...(d.leftOut.reversedReserve ? [`${nOf(d.leftOut.reversedReserve, "reserve addition")} that were reversed (they cancel out).`] : []),
        "AI receipt checks.",
      ];
      box.append(el("p", "db-note", `Left out: ${left.join(" ")}`));

      box.append(el("h3", "db-subhead", "who's who"));
      box.append(el("p", "db-note", "Each person in the finance app, and who they are in the portal. Their claims and saved payout details go to that member. Anyone with claims needs a member: pick one, or add them as a new member."));
      box.append(mapTable(d.people, [
        { label: "In the finance app", cell: (p) => nodes(el("strong", "", p.name), el("span", "muted", ` ${p.email || ""}${p.role === "finance" ? " · Finance" : p.role === "lead" ? " · lead" : ""}`)) },
        { label: "Claims", cls: "is-right", cell: (p) => String(p.claims) },
        { label: "In the portal", cell: (p) => {
          const opts = [...d.members.map((m) => [String(m.id), m.name]), ["new", "+ add as a new member"], ...(p.needed ? [] : [["skip", "leave out (nothing to copy)"]])];
          const sel = select(`Who ${p.name} is in the portal`, opts, p.suggest ? String(p.suggest) : p.needed ? "new" : "skip");
          sel.dataset.person = p.id;
          return nodes(sel, p.why ? el("span", "muted", ` ${p.why}`) : null);
        } },
      ]));
      box.append(el("h3", "db-subhead", "divisions"));
      box.append(el("p", "db-note", "Each budget lives in a division. Pick the org-chart division each of the finance app's divisions is, or add it to the org chart."));
      box.append(mapTable(d.divisions, [
        { label: "In the finance app", cell: (x) => nodes(el("strong", "", x.name), el("span", "muted", ` ${nOf(x.budgets, "budget")}`)) },
        { label: "On the org chart", cell: (x) => {
          const opts = [...d.units.map((u) => [String(u.id), u.name]), ["new", "+ add as a new division"]];
          const sel = select(`Which division ${x.name} is`, opts, x.suggest ? String(x.suggest) : "new");
          sel.dataset.division = x.id;
          return sel;
        } },
      ]));
      const notes = [];
      if (d.financeTeam.length) notes.push(`On the finance app's Finance team: ${d.financeTeam.map((f) => f.name).join(", ")}. Their portal logins (where they have one) go on the Finance team.`);
      const offChart = d.leads.filter((l) => !l.inChart);
      if (offChart.length) notes.push(`Division leads in the finance app who aren't leads on the org chart: ${offChart.map((l) => `${l.person} (${l.division})`).join(", ")}. In the portal, leads come from the org chart: give them a Founder, Chief of Staff or Director seat on the division if they should keep reviewing claims.`);
      notes.forEach((n) => box.append(el("p", "db-note", n)));

      const go = confirmButton("Import", "", runIt);
      go.classList.replace("db-btn--danger", "db-btn--primary");
      go.id = "fi-run";
      go.disabled = d.keyOk === false || !d.portalKey;
      const row = el("div", "db-actions");
      row.append(go, button("Cancel", "", () => intro()));
      box.append(row);
    }
    async function runIt() {
      const people = {}, divisions = {};
      $$("select[data-person]", box).forEach((x) => { people[x.dataset.person] = x.value; });
      $$("select[data-division]", box).forEach((x) => { divisions[x.dataset.division] = x.value; });
      box.replaceChildren(el("p", "db-note", "Copying claims, budgets and the bank ledger…"));
      const r = await finApi({ action: "import-run", people, divisions });
      if (!r || !r.ok) return intro(finErr(r, "The import stopped. Nothing is copied twice, so you can check and import again."));
      const res = r.data;
      const progress = el("p", "db-note", "Copying receipts…");
      box.replaceChildren(progress);
      let copied = 0;
      let skip = [];
      let stopped = "";
      for (;;) {
        const f = await finApi({ action: "import-receipts", skip });
        if (!f || !f.ok) { stopped = finErr(f, "Copying the receipts stopped."); break; }
        copied += f.data.copied;
        skip = skip.concat(f.data.failed);
        progress.textContent = `Copying receipts… ${copied} copied${f.data.remaining ? `, ${f.data.remaining} to go` : ""}`;
        if (f.data.remaining <= 0 || (!f.data.copied && !f.data.failed.length)) break;
      }
      info.last = { at: new Date().toISOString(), by: me.username };
      const done = el("div", "db-stack");
      done.id = "fi-result";
      done.append(el("p", "db-note", "Done. The finance app's data is in the portal."), fields([
        ["Claims copied", String(res.counts.claims)],
        ["Receipts copied", String(copied)],
        ...(res.created.people.length ? [["Members added", res.created.people.join(", ")]] : []),
        ...(res.created.divisions.length ? [["Divisions added", res.created.divisions.join(", ")]] : []),
        ...(res.financeTeam.length ? [["Put on the Finance team", res.financeTeam.join(", ")]] : []),
      ]));
      if (skip.length) done.append(el("p", "db-alert db-alert--warn", `${skip.length} ${skip.length === 1 ? "receipt" : "receipts"} couldn't be copied (they stay in the finance app): ${skip.join(", ")}`));
      if (stopped) done.append(el("p", "db-alert", `${stopped} Press "Check the finance app" and import again to copy the rest.`));
      const row = el("div", "db-actions");
      row.append(linkButton("See the claims", "#/fin/claims/all", "primary"), linkButton("Budgets", "#/fin/budgets"), linkButton("Bank", "#/fin/bank"));
      done.append(row);
      importDone = done;
      finSetupPage(); // new categories and notices show at once
    }
    if (importDone) {
      box.append(importDone);
      importDone = null;
    } else intro();
    return panel("import from the finance app", box);
  }

  /* ───────────── which view ───────────── */
  const ROUTES = [
    [/^#\/$/, () => homePage(), "home"],
    [/^#\/members$/, () => membersList(), "members"],
    [/^#\/m\/(new|\d+)$/, (m) => memberProfile(m[1]), "members"],
    [/^#\/members\/chart$/, () => orgChart(), "chart"],
    [/^#\/org\/new\/(division|domain|team)(?:\/(\d+))?$/, (m) => unitForm("new", m[1], m[2]), "chart", ["master", "admin"]],
    [/^#\/org\/import$/, () => importPage(), "chart", ["master", "admin"]],
    [/^#\/org\/(\d+)$/, (m) => unitForm(m[1]), "chart", ["master", "admin"]],
    [/^#\/applications$/, () => applicationsList(), "applications", ["master", "admin"]],
    [/^#\/a\/(\d+)$/, (m) => applicationDetail(m[1]), "applications", ["master", "admin"]],
    [/^#\/whats-on$/, () => whatsOn(), "whats-on", ["master", "admin"]],
    [/^#\/w\/(ip|event)\/(new|\d+)$/, (m) => whatsOnForm(m[1], m[2]), "whats-on", ["master", "admin"]],
    [/^#\/accounts$/, () => accountsList(), "accounts", ["master"]],
    [/^#\/accounts\/new(?:\/(\d+))?$/, (m) => accountForm(m[1]), "accounts", ["master"]],
    [/^#\/accounts\/(\d+)$/, (m) => accountDetail(m[1]), "accounts", ["master"]],
    [/^#\/r\/([a-z_]+)$/, (m) => collectionList(m[1]), (m) => m[1], null, (m) => Boolean(schema[m[1]])],
    [/^#\/r\/([a-z_]+)\/(new|\d+)(?:\?(.*))?$/, (m) => recordPage(m[1], m[2], Object.fromEntries(new URLSearchParams(m[3] || ""))), (m) => m[1], null, (m) => Boolean(schema[m[1]])],
    [/^#\/search\/(.+)$/, (m) => searchPage(decodeURIComponent(m[1])), "search"],
    [/^#\/activity$/, () => activityPage(), "activity", ["master", "admin"]],
    [/^#\/privacy$/, () => privacyPage(), "privacy", ["master"]],
    [/^#\/fin\/claims$/, () => claimsList("mine"), "fin-claims"],
    [/^#\/fin\/claims\/(review|all)$/, (m) => claimsList(m[1]), "fin-claims", null, () => finMe.finance || finMe.isLead],
    [/^#\/fin\/claims\/new$/, () => newClaimPage(), "fin-claims"],
    [/^#\/fin\/c\/(\d+)$/, (m) => claimPage(m[1]), "fin-claims"],
    [/^#\/fin\/budgets$/, () => budgetsList(), "fin-budgets", null, () => finMe.finance || finMe.isLead],
    [/^#\/fin\/b\/(new|\d+)$/, (m) => budgetPage(m[1]), "fin-budgets", null, () => finMe.finance || finMe.isLead],
    [/^#\/fin\/payouts$/, () => payoutsList(), "fin-payouts", null, () => finMe.finance],
    [/^#\/fin\/bank$/, () => bankPage(), "fin-bank", null, () => finMe.finance],
    [/^#\/fin\/setup$/, () => finSetupPage(), "fin-setup", null, () => finMe.finance],
  ];

  function route() {
    if (!me) return;
    const hash = location.hash || "#/";
    const hit = ROUTES.find(([re, , , roles, ok]) => re.test(hash) && (!roles || roles.includes(me.role)) && (!ok || ok(hash.match(re))));
    if (!hit) { location.hash = "#/"; return; }
    const m = hash.match(hit[0]);
    const tab = typeof hit[2] === "function" ? hit[2](m) : hit[2];
    const hat = hatList.find((h) => h.items.some(([key]) => key === tab));
    markNav(hat, tab);
    $$("[data-area]").forEach((p) => { p.textContent = hat ? hat.label : "admin"; });
    hit[1](m);
  }
  addEventListener("hashchange", route);

  /* ───────────── start ───────────── */
  api("/api/admin/session")
    .then((r) => (r.ok ? signedIn(r.data.user) : signedOut()))
    .catch(() => signedOut());
})();

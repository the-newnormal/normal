(() => {
  const app = document.getElementById("app");
  const stage = document.getElementById("stage");
  const plan = document.getElementById("plan");
  const notes = document.getElementById("notes");
  const handle = document.getElementById("handle");
  const panels = [...document.querySelectorAll("[data-panel]")];
  const spots = [...plan.querySelectorAll(".spot")];
  const mobile = matchMedia("(max-width: 959px)");

  // The plan's drawing area, and the part of it each panel zooms to (SVG units).
  const PLAN = { x: 0, y: 0, w: 640, h: 720 };
  const ZOOM = {
    kitchen: [320, 335, 280, 225],
    living:  [40, 335, 280, 225],
    bedroom: [320, 110, 280, 225],
    library: [40, 110, 280, 225],
    door:    [160, 470, 190, 150],
    garden:  [16, 580, 608, 135],
    north:   [20, 0, 230, 100],
  };
  const MAX_ZOOM = 2.3;
  const HOME_TITLE = document.title;

  let current = "home";

  const isPanel = (id) => panels.some((p) => p.id === id);
  const idFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    return isPanel(id) ? id : "home";
  };

  /* ───────────── zoom the plan towards a room ───────────── */
  function zoom() {
    const box = ZOOM[current];
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!box || !W || !H) {
      plan.style.transform = "";
      return;
    }

    // how the SVG sits in the stage at rest (preserveAspectRatio: meet)
    const base = Math.min(W / PLAN.w, H / PLAN.h);
    const ox = (W - PLAN.w * base) / 2;
    const oy = (H - PLAN.h * base) / 2;

    // the part of the stage not covered by the notes sheet
    let visH = H;
    if (mobile.matches) {
      const sheet = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-room")) || 60;
      visH = Math.min(H, innerHeight * (1 - sheet / 100));
    }
    const pad = { t: mobile.matches ? 16 : 64, r: 16, b: 16, l: 16 };
    const vis = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: visH - pad.t - pad.b };

    const [bx, by, bw, bh] = box;
    const k = Math.max(1, Math.min(MAX_ZOOM, vis.w / (bw * base), vis.h / (bh * base)));
    const cx = ox + (bx + bw / 2) * base;
    const cy = oy + (by + bh / 2) * base;
    const tx = vis.x + vis.w / 2 - cx * k;
    const ty = vis.y + vis.h / 2 - cy * k;
    plan.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  }

  /* ───────────── show a panel ───────────── */
  function show(id, { focus = false } = {}) {
    current = id;
    panels.forEach((p) => p.classList.toggle("is-current", p.id === id));
    spots.forEach((s) => s.classList.toggle("is-current", s.dataset.spot === id));
    app.classList.toggle("is-room", id !== "home");
    setExpanded(false);
    notes.scrollTop = 0;
    zoom();

    const panel = document.getElementById(id);
    const heading = panel.querySelector("h2");
    document.title = id === "home" ? HOME_TITLE : `${heading.textContent.trim()} · Normal`;
    if (focus) heading.focus({ preventScroll: true });
  }

  function go(id, opts) {
    if (id === current) return;
    const url = id === "home" ? location.pathname + location.search : `#${id}`;
    history.pushState({ id }, "", url);
    show(id, opts);
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (!a) return;
    const id = a.getAttribute("href").slice(1) || "home";
    if (!isPanel(id)) return;
    e.preventDefault();
    go(id, { focus: true });
  });

  addEventListener("popstate", () => show(idFromHash()));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current !== "home") go("home", { focus: true });
  });

  /* ───────────── mobile sheet handle ───────────── */
  function setExpanded(on) {
    app.classList.toggle("is-expanded", on);
    handle.setAttribute("aria-expanded", String(on));
    handle.querySelector(".sr-only").textContent = on ? "Show less" : "Show more";
  }
  handle.addEventListener("click", () => setExpanded(!app.classList.contains("is-expanded")));

  /* ───────────── legend ↔ plan hover ───────────── */
  document.querySelectorAll(".legend a").forEach((a) => {
    const spot = plan.querySelector(`.spot[href="${a.getAttribute("href")}"]`);
    if (!spot) return;
    a.addEventListener("mouseenter", () => spot.classList.add("is-hover"));
    a.addEventListener("mouseleave", () => spot.classList.remove("is-hover"));
  });

  /* ───────────── the door ───────────── */
  document.querySelectorAll(".door").forEach((door) => {
    door.addEventListener("click", () => {
      const open = door.getAttribute("aria-pressed") !== "true";
      door.setAttribute("aria-pressed", String(open));
      door.setAttribute("aria-label", open ? "Close the door" : "Open the door");
    });
  });

  /* ───────────── events (from events.js) ───────────── */
  function renderEvents() {
    const box = document.getElementById("events");
    if (!box) return;
    const list = (window.NORMAL_EVENTS || []).filter((e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    const toDate = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = list.filter((e) => toDate(e.date) >= today).sort((a, b) => toDate(a.date) - toDate(b.date));
    const past = list.filter((e) => toDate(e.date) < today).sort((a, b) => toDate(b.date) - toDate(a.date)).slice(0, 6);

    box.replaceChildren();
    if (!upcoming.length && !past.length) {
      const p = document.createElement("p");
      p.className = "events__empty";
      p.textContent = "Nothing on the shelves yet. The next gathering lands here first.";
      box.append(p);
      return;
    }

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };

    [...upcoming, ...past].forEach((e) => {
      const d = toDate(e.date);
      const card = el("article", d < today ? "event event--past" : "event");
      const date = el("div", "event__date", String(d.getDate()));
      date.append(el("small", "", d.toLocaleDateString("en-SG", { month: "short" })));

      const body = el("div");
      body.append(el("h4", "", e.title));
      const meta = [d.toLocaleDateString("en-SG", { weekday: "short", year: "numeric" }), e.time, e.place].filter(Boolean).join(" · ");
      body.append(el("p", "event__meta", meta));
      if (e.blurb) body.append(el("p", "", e.blurb));
      if (e.link && /^https?:\/\//.test(e.link) && d >= today) {
        const a = el("a", "next", "Sign up →");
        a.href = e.link;
        a.target = "_blank";
        a.rel = "noopener";
        const p = el("p");
        p.append(a);
        body.append(p);
      }
      card.append(date, body);
      box.append(card);
    });
  }

  /* ───────────── start ───────────── */
  document.getElementById("year").textContent = new Date().getFullYear();
  renderEvents();
  show(idFromHash());

  let raf;
  addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(zoom);
  });
  mobile.addEventListener("change", zoom);
})();

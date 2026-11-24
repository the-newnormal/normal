(() => {
  const root = document.documentElement;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const stripIds = (node) => {
    node.removeAttribute("id");
    $$("[id]", node).forEach((n) => n.removeAttribute("id"));
    return node;
  };

  /* ───────────── the 3D house ───────────── */
  const house = $("#house");
  if (house) {
    const scene = $("#scene");
    const wrap = $("#house-wrap");
    const tip = $("#tip");

    // stack copies of the walls to give them height
    const top = $(".wall-layer.is-top", scene);
    const LAYERS = 13;
    for (let i = 0; i < LAYERS; i++) {
      const layer = stripIds(top.cloneNode(true));
      layer.classList.remove("is-top");
      layer.style.setProperty("--i", i);
      scene.insertBefore(layer, top);
    }
    top.style.setProperty("--i", LAYERS);

    const anchors = $$(".anchor", scene);
    const pins = new Map($$(".pin", house).map((p) => [p.dataset.room, p]));
    const spots = $$(".spot", scene);
    const people = $$(".person", scene);

    // the people: a black dot for a head (like the knob in the n), a white body
    const BODY = "M3,37.5 C3,27 5.5,21 11,21 C16.5,21 19,27 19,37.5 Z";
    const FIG = `<svg class="person__fig" viewBox="0 0 22 38" aria-hidden="true">
      <path class="person__body" d="${BODY}"/>
      <path class="person__shade" d="M11,21 C16.5,21 19,27 19,37.5 L14.5,37.5 C14.5,29 13.5,24 11,21 Z"/>
      <path class="person__line" d="${BODY}"/>
      <circle class="person__head" cx="11" cy="13.5" r="6.5"/>
    </svg>`;
    people.forEach((p) => { p.innerHTML = FIG; });

    let active = null;
    let activeAtDown = null;
    let lastPointer = "mouse";

    const docked = () => getComputedStyle(tip).position === "static";

    function layout() {
      const W = house.clientWidth;
      const H = house.clientHeight;
      if (!W || !H) return;
      // measure the tilted floor at scale 1, then fit it (leaving room for walls and pins)
      scene.style.setProperty("--s", 1);
      scene.style.setProperty("--dy", "0px");
      const r = scene.getBoundingClientRect();
      const s = Math.min((W - 16) / r.width, (innerHeight * 0.82 - 90) / (r.height + 40));
      scene.style.setProperty("--s", s.toFixed(4));
      // size the box to the drawing, with room on top for the walls and pins
      const h = Math.ceil((r.height + 40) * s + 34);
      if (Math.abs(house.offsetHeight - h) > 1) {
        house.style.aspectRatio = "auto";
        house.style.height = `${h}px`;
      }
      const hr = house.getBoundingClientRect();
      const sr = scene.getBoundingClientRect();
      scene.style.setProperty("--dy", `${(hr.top + hr.height - 14 - sr.bottom).toFixed(1)}px`);
      anchors.forEach((a) => {
        const pin = pins.get(a.dataset.room);
        const ar = a.getBoundingClientRect();
        pin.style.setProperty("--px", `${ar.left - hr.left}px`);
        pin.style.setProperty("--py", `${ar.top - hr.top}px`);
      });
      house.classList.add("is-ready");
      if (active) placeTip();
    }

    function fill(id) {
      const t = document.getElementById(`tip-${id}`);
      if (!t) return;
      tip.replaceChildren(t.content.cloneNode(true));
      // the floating card can't be clicked (so it never blocks the rooms behind it):
      // rooms that lead somewhere say "click" instead of showing a link
      const more = $(".tip__more", tip);
      if (more && !docked()) tip.append(Object.assign(document.createElement("p"), { className: "tip__cue", textContent: more.dataset.cue }));
    }

    function placeTip() {
      if (docked()) {
        tip.style.removeProperty("--tx");
        tip.style.removeProperty("--ty");
        return;
      }
      const pin = pins.get(active);
      const wr = wrap.getBoundingClientRect();
      const pr = pin.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const x = Math.max(0, Math.min(wr.width - tw, pr.left - wr.left + pr.width / 2 - tw / 2));
      let y = pr.top - wr.top - th - 12;
      if (y < 0) y = pr.bottom - wr.top + 12;
      tip.style.setProperty("--tx", `${x}px`);
      tip.style.setProperty("--ty", `${y}px`);
    }

    function show(id) {
      if (active === id) return;
      active = id;
      fill(id);
      pins.forEach((p, k) => p.classList.toggle("is-active", k === id));
      spots.forEach((s) => s.classList.toggle("is-active", s.dataset.room === id));
      tip.classList.add("is-open");
      placeTip();
    }

    function hide() {
      if (!active) return;
      active = null;
      pins.forEach((p) => p.classList.remove("is-active"));
      spots.forEach((s) => s.classList.remove("is-active"));
      tip.classList.remove("is-open");
      if (docked()) fill("default");
    }

    // hover (or focus, or tap) to peek
    house.addEventListener("pointerdown", (e) => {
      lastPointer = e.pointerType;
      activeAtDown = active;
    }, true);
    // the card goes as soon as the mouse leaves the room or its pin. The short delay only
    // stops a flicker when the mouse crosses from a room onto its own pin (or the next room).
    let hideTimer;
    [...spots, ...pins.values()].forEach((el) => {
      const id = el.dataset.room;
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(hideTimer);
        show(id);
      });
      el.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 40);
      });
      el.addEventListener("focus", () => show(id));
      el.addEventListener("click", (e) => {
        // links (front door, library): on touch, the first tap peeks and a second tap follows
        if (el.matches("a") && lastPointer !== "mouse" && e.detail !== 0 && activeAtDown !== id) e.preventDefault();
        show(id);
      });
    });
    wrap.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    wrap.addEventListener("focusout", (e) => { if (!wrap.contains(e.relatedTarget)) hide(); });
    document.addEventListener("pointerdown", (e) => { if (!wrap.contains(e.target)) hide(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

    if (docked()) fill("default");
    let raf;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layout);
    }).observe(house);
    document.fonts?.ready.then(layout);
  }

  /* ───────────── nav gets a line once you scroll ───────────── */
  const nav = $("#nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ───────────── the door ───────────── */
  $$(".door").forEach((door) => {
    door.addEventListener("click", () => {
      const open = door.getAttribute("aria-pressed") !== "true";
      door.setAttribute("aria-pressed", String(open));
      door.setAttribute("aria-label", open ? "Close the door" : "Open the door");
    });
  });

  /* ───────────── events (from events.js) ───────────── */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const safeUrl = (u) => typeof u === "string" && /^(https?:\/\/|assets\/|\.\/)/.test(u);
  const toDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  function eventCard(e, isPast) {
    const d = toDate(e.date);
    const card = el("article", `event${isPast ? " event--past" : ""}${safeUrl(e.image) ? " event--photo" : ""}`);
    if (safeUrl(e.image)) {
      const img = el("img", "event__img");
      img.src = e.image;
      img.alt = "";
      img.loading = "lazy";
      card.append(img);
    }
    const row = safeUrl(e.image) ? el("div", "event__row") : card;
    const date = el("div", "event__date", String(d.getDate()));
    date.append(el("small", "", d.toLocaleDateString("en-SG", { month: "short" })));
    const body = el("div");
    body.append(el("h4", "", e.title));
    const meta = [d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", year: "numeric" }), e.time, e.place].filter(Boolean).join(" · ");
    body.append(el("p", "event__meta", meta));
    if (e.blurb) body.append(el("p", "", e.blurb));
    const href = isPast ? e.recap : e.link;
    if (safeUrl(href)) {
      const a = el("a", "link", isPast ? "See the recap →" : "Sign up →");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      const p = el("p");
      p.append(a);
      body.append(p);
    }
    row.append(date, body);
    if (row !== card) card.append(row);
    return card;
  }

  function renderEvents() {
    const list = (window.NORMAL_EVENTS || []).filter((e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = list.filter((e) => toDate(e.date) >= today).sort((a, b) => toDate(a.date) - toDate(b.date));
    const past = list.filter((e) => toDate(e.date) < today).sort((a, b) => toDate(b.date) - toDate(a.date));
    const fillBox = (box, items, isPast, empty) => {
      if (!box) return;
      box.replaceChildren(...(items.length ? items.map((e) => eventCard(e, isPast)) : [el("p", "events__empty", empty)]));
    };

    fillBox($("#events-upcoming"), upcoming, false, "Nothing coming up just yet. The next gathering lands here first.");
    fillBox($("#events-past"), past, true, "Past gatherings will be collected here.");
  }
  renderEvents();

  /* ───────────── fade things in as they scroll into view ───────────── */
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    $$(".reveal").forEach((n) => io.observe(n));
  }

  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();
})();

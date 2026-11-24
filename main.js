(() => {
  const root = document.documentElement;

  /* ───────────── room details: reuse the plan's drawing, cropped to each room ───────────── */
  const art = document.getElementById("plan-art");
  document.querySelectorAll("[data-crop]").forEach((svg) => {
    const copy = art.cloneNode(true);
    copy.removeAttribute("id");
    svg.append(copy);
  });

  /* ───────────── nav gets a line once you scroll ───────────── */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

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

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };

    box.replaceChildren();
    if (!upcoming.length && !past.length) {
      box.append(el("p", "events__empty", "Nothing on the shelves yet. The next gathering lands here first."));
      return;
    }

    [...upcoming, ...past].forEach((e) => {
      const d = toDate(e.date);
      const isPast = d < today;
      const card = el("article", isPast ? "event event--past" : "event");
      const date = el("div", "event__date", String(d.getDate()));
      date.append(el("small", "", d.toLocaleDateString("en-SG", { month: "short" })));

      const body = el("div");
      body.append(el("h4", "", e.title));
      const meta = [d.toLocaleDateString("en-SG", { weekday: "short", year: "numeric" }), e.time, e.place].filter(Boolean).join(" · ");
      body.append(el("p", "event__meta", meta));
      if (e.blurb) body.append(el("p", "", e.blurb));
      if (!isPast && e.link && /^https?:\/\//.test(e.link)) {
        const a = el("a", "link", "Sign up →");
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
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  }

  document.getElementById("year").textContent = new Date().getFullYear();
})();

// The join page: renders join-form.json as a step-by-step form, keeps a draft on this
// device, and sends the finished application to /api/join (which passes it to Fillout).
(() => {
  const DRAFT_KEY = "normal-join-draft-v1";
  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  const formEl = $("#join-form");
  const body = $("#join-body");
  const stepsNav = $("#join-steps");
  const back = $("#join-back");
  const next = $("#join-next");
  const status = $("#join-status");
  const saved = $("#join-saved");
  const done = $("#join-done");

  let form;            // join-form.json
  let current = 0;     // step shown
  let furthest = 0;    // furthest step reached
  const fieldsets = [];

  const storage = {
    get() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; } },
    set(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ } },
  };

  /* ───────────── build the form ───────────── */
  const uid = (q, i) => `q-${q.id}${i === undefined ? "" : `-${i}`}`;

  function labelFor(q, wrap, forId) {
    if (q.lead) wrap.append(el("p", "q__lead", q.lead));
    if (q.list) {
      const ol = el("ol", "q__list");
      q.list.forEach((t) => ol.append(el("li", "", t)));
      wrap.append(ol);
    }
    const lab = el(forId ? "label" : "legend", "q__label");
    if (forId) lab.htmlFor = forId;
    if (q.labelHtml) lab.innerHTML = q.labelHtml; // authored in join-form.json, not user input
    else lab.textContent = q.label;
    if (!q.required) lab.append(el("span", "q__opt", "(optional)"));
    wrap.append(lab);
    if (q.hint) wrap.append(el("p", "q__hint", q.hint));
  }

  function pills(name, values, type = "radio") {
    const box = el("div", "pills");
    values.forEach((v, i) => {
      const l = el("label", "pill");
      const input = el("input");
      input.type = type;
      input.name = name;
      input.value = v;
      input.id = `${name}-${i}`;
      l.append(input, el("span", "", v));
      box.append(l);
    });
    return box;
  }

  function buildQuestion(q) {
    let wrap;
    if (q.type === "short" || q.type === "long" || q.type === "date") {
      wrap = el("div", "q");
      labelFor(q, wrap, uid(q));
      let input;
      if (q.type === "long") {
        input = el("textarea");
        input.rows = 4;
      } else {
        input = el("input");
        input.type = q.type === "date" ? "date" : q.inputmode === "tel" ? "tel" : "text";
        if (q.placeholder) input.placeholder = q.placeholder;
        if (q.autocomplete) input.autocomplete = q.autocomplete;
      }
      input.id = uid(q);
      input.name = q.id;
      if (q.required) input.required = true;
      wrap.append(input);
    } else if (q.type === "choice") {
      wrap = el("fieldset", "q");
      labelFor(q, wrap);
      wrap.append(pills(q.id, q.options));
    } else if (q.type === "matrix") {
      wrap = el("fieldset", "q q--matrix");
      labelFor(q, wrap);
      q.rows.forEach((row, i) => {
        const r = el("div", "mrow");
        const p = el("p", "mrow__label");
        const cut = q.roles ? row.indexOf(": ") : -1;
        if (cut > 0) {
          p.append(el("strong", "", row.slice(0, cut)), ` ${row.slice(cut + 2)}`);
        } else {
          p.textContent = row;
        }
        r.append(p, pills(`${q.id}__${i}`, q.columns));
        wrap.append(r);
      });
      // roles: each choice (1st, 2nd, 3rd) can only go to one role
      if (q.roles) {
        wrap.addEventListener("change", (e) => {
          if (!e.target.checked) return;
          wrap.querySelectorAll(`input[value="${CSS.escape(e.target.value)}"]`).forEach((other) => {
            if (other !== e.target) other.checked = false;
          });
        });
      }
    } else if (q.type === "consent") {
      wrap = el("div", "q q--consent");
      const l = el("label", "consent");
      const input = el("input");
      input.type = "checkbox";
      input.id = uid(q);
      input.name = q.id;
      l.append(input, el("span", "", q.label));
      wrap.append(l);
    }
    wrap.dataset.q = q.id;
    wrap.append(el("p", "q__error"));
    return wrap;
  }

  function build() {
    body.replaceChildren();
    form.steps.forEach((step, i) => {
      const fs = el("fieldset", "join__step");
      fs.hidden = true;
      const h = el("h2", "", step.heading);
      h.tabIndex = -1;
      fs.append(el("p", "kicker", `${i + 1} of ${form.steps.length}`), h);
      if (step.noticeHtml) {
        const n = el("div", "join__notice");
        n.innerHTML = step.noticeHtml; // authored in join-form.json
        fs.append(n);
      }
      step.questions.forEach((q) => fs.append(buildQuestion(q)));
      body.append(fs);
      fieldsets.push(fs);

      const li = el("li");
      const b = el("button", "step-pill");
      b.type = "button";
      b.append(el("span", "badge", String(i + 1)), el("span", "step-pill__name", step.title));
      b.addEventListener("click", () => { if (i <= furthest) go(i); });
      li.append(b);
      stepsNav.append(li);
    });
  }

  /* ───────────── answers ───────────── */
  function read(q) {
    if (q.type === "short" || q.type === "long" || q.type === "date") {
      return formEl.elements[q.id].value.trim();
    }
    if (q.type === "choice") {
      return formEl.querySelector(`input[name="${q.id}"]:checked`)?.value || "";
    }
    if (q.type === "matrix") {
      const out = {};
      q.rows.forEach((row, i) => {
        const v = formEl.querySelector(`input[name="${q.id}__${i}"]:checked`)?.value;
        if (v) out[row] = v;
      });
      return out;
    }
    if (q.type === "consent") return formEl.elements[q.id].checked;
    return "";
  }

  function write(q, v) {
    if (v === undefined || v === null) return;
    if (q.type === "short" || q.type === "long" || q.type === "date") {
      formEl.elements[q.id].value = v;
    } else if (q.type === "choice") {
      const r = formEl.querySelector(`input[name="${q.id}"][value="${CSS.escape(v)}"]`);
      if (r) r.checked = true;
    } else if (q.type === "matrix" && typeof v === "object") {
      q.rows.forEach((row, i) => {
        if (!v[row]) return;
        const r = formEl.querySelector(`input[name="${q.id}__${i}"][value="${CSS.escape(v[row])}"]`);
        if (r) r.checked = true;
      });
    } else if (q.type === "consent") {
      formEl.elements[q.id].checked = v === true;
    }
  }

  const allQuestions = () => form.steps.flatMap((s) => s.questions);
  const answers = () => Object.fromEntries(allQuestions().map((q) => [q.id, read(q)]));

  function filled(q, v) {
    if (q.type === "matrix") return q.rows.every((r) => v[r]);
    if (q.type === "consent") return v === true;
    return Boolean(v);
  }

  /* ───────────── draft on this device ───────────── */
  let saveTimer;
  let sent = false;   // once sent, never write the draft back
  function saveDraft() {
    clearTimeout(saveTimer);
    if (sent) return;
    saveTimer = setTimeout(() => {
      if (storage.set({ answers: answers(), step: current, furthest })) {
        saved.textContent = "draft saved on this device";
      }
    }, 400);
  }

  function restoreDraft() {
    const d = storage.get();
    if (!d || !d.answers) return;
    allQuestions().forEach((q) => write(q, d.answers[q.id]));
    furthest = Math.min(Number(d.furthest) || 0, form.steps.length - 1);
    current = Math.min(Number(d.step) || 0, furthest);
    saved.textContent = "picked up where you left off";
  }

  /* ───────────── steps ───────────── */
  function validate(i) {
    let first = null;
    form.steps[i].questions.forEach((q) => {
      const box = body.querySelector(`[data-q="${q.id}"]`);
      const ok = !q.required || filled(q, read(q));
      box.classList.toggle("is-invalid", !ok);
      $(".q__error", box).textContent = ok ? "" : q.type === "matrix" ? "pick one for every row" : q.type === "consent" ? "we need your okay to read your application" : "this one's needed";
      if (!ok && !first) first = box;
    });
    if (first) {
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      $("input, textarea", first)?.focus({ preventScroll: true });
    }
    return !first;
  }

  function go(i, { focus = true } = {}) {
    current = i;
    furthest = Math.max(furthest, i);
    fieldsets.forEach((fs, j) => { fs.hidden = j !== i; });
    [...stepsNav.children].forEach((li, j) => {
      const b = $("button", li);
      b.classList.toggle("is-current", j === i);
      b.classList.toggle("is-done", j < furthest && j !== i);
      b.disabled = j > furthest;
      if (j === i) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    back.style.visibility = i === 0 ? "hidden" : "visible";
    next.textContent = i === form.steps.length - 1 ? "send it ✉" : "next →";
    status.textContent = "";
    status.classList.remove("is-error");
    if (focus) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
      $("h2", fieldsets[i]).focus({ preventScroll: true });
      saveDraft();
    }
  }

  back.addEventListener("click", () => { if (current > 0) go(current - 1); });

  /* ───────────── send ───────────── */
  async function send() {
    next.disabled = true;
    back.disabled = true;
    status.classList.remove("is-error");
    status.textContent = "sending…";
    let res, data = {};
    try {
      res = await fetch("api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answers(), website: formEl.elements.website.value }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      res = null;
    }
    next.disabled = false;
    back.disabled = false;

    if (res && res.ok) {
      sent = true;
      clearTimeout(saveTimer);
      storage.clear();
      formEl.hidden = true;
      stepsNav.hidden = true;
      $("#join-thanks-title").textContent = form.thanks.title;
      $("#join-thanks-text").textContent = form.thanks.text;
      done.hidden = false;
      done.scrollIntoView({ behavior: "smooth", block: "center" });
      done.focus({ preventScroll: true });
      return;
    }

    status.classList.add("is-error");
    if (res && res.status === 400 && data.missing && data.missing.length) {
      const stepIndex = form.steps.findIndex((s) => s.questions.some((q) => data.missing.includes(q.id)));
      if (stepIndex >= 0) { go(stepIndex); validate(stepIndex); }
      status.textContent = "a few answers are still needed.";
      return;
    }
    const fallback = document.createElement("a");
    fallback.href = form.fillout.url;
    fallback.textContent = "our Fillout form";
    if (res && res.status === 503) {
      status.replaceChildren("we can't send applications from this page just yet. your answers are saved on this device; for now please apply through ", fallback, ".");
    } else {
      status.replaceChildren("something went wrong sending this. your answers are saved on this device, so try again in a minute, or apply through ", fallback, ".");
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validate(current)) return;
    if (current < form.steps.length - 1) go(current + 1);
    else send();
  });
  formEl.addEventListener("input", (e) => {
    const box = e.target.closest(".q.is-invalid");
    if (box) {
      box.classList.remove("is-invalid");
      $(".q__error", box).textContent = "";
    }
    saveDraft();
  });
  formEl.addEventListener("change", saveDraft);

  /* ───────────── start ───────────── */
  fetch("join-form.json")
    .then((r) => r.json())
    .then((json) => {
      form = json;
      build();
      restoreDraft();
      go(current, { focus: false });
    })
    .catch(() => {
      body.replaceChildren(el("p", "join__loading", "the form couldn't load. please refresh, or apply through our Fillout form: "));
      const a = document.createElement("a");
      a.href = "https://newnormal.fillout.com/recruitment";
      a.textContent = "newnormal.fillout.com/recruitment";
      body.firstChild.append(a);
      $(".join__nav").hidden = true;
    });
})();

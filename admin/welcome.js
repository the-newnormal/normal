// The page a setup link opens: admin.newnormal.sg/welcome#t=<token>
// The token sits after the # so it never reaches server logs; it's wiped from the address bar straight away.
(() => {
  const $ = (s) => document.querySelector(s);
  const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
  history.replaceState(null, "", location.pathname);
  const home = location.hostname === "admin.newnormal.sg" ? "/" : "/admin/";
  $("#w-dead a").href = home;

  const call = (body) => fetch("/api/admin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "normal-admin" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

  const dead = () => { $("#w-form").hidden = true; $("#w-dead").hidden = false; };
  if (!token) return dead();

  call({ action: "peek", token }).then((r) => {
    if (!r.ok) return dead();
    $("#w-name").textContent = r.data.name;
    $("#w-username").textContent = r.data.username;
    $("#w-user").value = r.data.username; // lets password managers save the pair
    $("#w-form").hidden = false;
    $("#w-pass").focus();
  }).catch(dead);

  $("#w-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#w-error");
    const pass = $("#w-pass").value;
    err.textContent =
      pass.length < 10 ? "use 10 characters or more." :
      pass !== $("#w-pass2").value ? "the two passwords don't match." : "";
    if (err.textContent) return;
    $("#w-go").disabled = true;
    const r = await call({ action: "setup", token, password: pass }).catch(() => ({ ok: false }));
    $("#w-go").disabled = false;
    if (r.ok) return location.replace(home);
    if (r.status === 404) return dead();
    err.textContent = "couldn't save that just now. try again.";
  });
})();

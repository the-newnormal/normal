// Turns a name + password into an ADMIN_USERS line, entirely in the browser.
// Format: name:pbkdf2$<iterations>$<salt>$<hash>  (base64url, PBKDF2-SHA256), checked by lib/auth.js.
(() => {
  const ITERATIONS = 210000;
  const $ = (s) => document.querySelector(s);
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
    return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
  }

  $("#setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#s-error");
    err.textContent = "";
    const name = $("#s-name").value.trim().toLowerCase();
    const pass = $("#s-pass").value;
    if (!/^[a-z0-9._-]{2,32}$/.test(name)) return (err.textContent = "use 2–32 lowercase letters, numbers, dots, dashes or underscores.");
    if (pass.length < 12) return (err.textContent = "make the password at least 12 characters.");
    if (pass !== $("#s-pass2").value) return (err.textContent = "the two passwords don't match.");
    if (!window.crypto || !crypto.subtle) return (err.textContent = "this browser can't do it here. open the page over https.");
    $("#s-line").value = `${name}:${await hash(pass)}`;
    $("#s-pass").value = $("#s-pass2").value = "";
    $("#s-out").hidden = false;
    $("#s-line").select();
  });

  $("#s-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#s-line").value); $("#s-copy").textContent = "copied ✓"; }
    catch { $("#s-line").select(); }
  });
})();

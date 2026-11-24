# Normal: website

A home built for us to be human. The home page has three parts: a hero, a hand-drawn floor plan tilted into 3D, and a "Come in" footer with contact links. Hover over a room (or tap it on a phone) to see a short card about it. The front door leads to "Come in", and the library leads to the events page.

Pages: `index.html` (home), `events.html` (what's on), `join.html` (join us: the recruitment form) and the admin portal at admin.newnormal.sg (`admin/`).

| Part of the plan | What its card says |
|---|---|
| Front door | Who we stand for |
| 1 Kitchen | A laboratory · *Adventure, not fear* · Courage to explore |
| 2 Living room | A seat at the table · *Considered, not dismissed* · Authenticity & intention |
| 3 Bedroom | A shelter: real rest |
| 4 Library | A living library · events · Staying curious |
| Garden | *Flourish, not bare survival* · *Fulfilled* |
| North arrow | Our north star |

The copy comes from the "About normal" doc.

## Run it

It's a static site with no build step. Open `index.html`, or:

```bash
python3 -m http.server
```

Deploy it to any static host (Vercel, Netlify, GitHub Pages).

## Add an IP or an event

Admins edit the "what's on" page (`events.html`) in the portal: **admin.newnormal.sg → what's on**. Changes show on the page within a minute.

- **Our IPs**: name, the small line above it, the line below, a link (its own site, e.g. `https://youthday.sg`) and an image. The "card style" dresses it like Backyard's or Youth Day's own site (colours and fonts from backyard.sg and youthday.sg; the fonts load from Google Fonts on `events.html` only). With no style it's a plain Normal card, and with no link it says "page coming soon". Use ↑ ↓ to reorder.
- **Events**: title, date, time, place, a blurb, a sign-up link (shown while upcoming), a recap link (shown once it's past) and a photo. Untick "show on the what's on page" to keep one hidden.
- Images can be full `https://` addresses, or files you add to `assets/ips/` and `assets/events/`.

`whats-on.json` is the starting data: it's copied into the database the first time, and the page falls back to it if the database can't be reached.

## The admin portal (admin.newnormal.sg)

One place for Normal's people and admin.

| Section | What's in it | Who sees it |
|---|---|---|
| members | Everyone in Normal: name, title, role, seat on the org chart, Telegram, phone, email, birthday, school, joined, status, notes. A table (search, filter by division or team, export) and an **org chart**. | Everyone. Members see only name, title, role, seat and Telegram of others, edit only their own contact details, and can't change the chart. |
| applications | Join-page applications: full answers, status (new, interviewing, accepted, declined), "accept" adds them to members. Export. | Admins |
| what's on | The IPs and events on the what's on page | Admins |
| accounts | Who can sign in, and as what | Master Admins |

**The org chart** (members → Org chart) follows the Team Map: Normal → divisions → domains → teams, each with a code like FL or FL.1. Admins add and rename them on the chart (+ add division, + domain, + team; click a name to edit). A domain can be "overseen by" Founders, Chiefs of Staff or Directors. To place someone, open their member record and set their **role in Normal** (Founder, Chief of Staff, Director, Team Lead, Member, Fellow, Volunteer) and **seat**. Founders and Chiefs of Staff without a seat sit at the top; anyone else without a seat is listed under "not on the chart". Hover a Director to see what they oversee. A division, domain or team can only be deleted once it's empty.

**Roles.** Master Admin: everything, plus accounts. Admin: everything except accounts. Member: the members directory and their own profile.

**Giving someone a login.** accounts → create an account (or "make them a login" on their member profile). Pick their role and their member profile. You get a one-time link to send on WhatsApp or Telegram; they open it and choose their own password. Links work once and last 7 days. If someone forgets their password, open their account → new password link.

**Taking access away.** Disable or delete the account, or change their role. Any of these signs them out straight away.

`join.html` is the recruitment form, rebuilt from the Fillout form. The questions live in `join-form.json`; edit them there and the page, the database and the admin all follow. Each question's `id` is its Fillout question ID, so keep those as they are.

| Piece | Where |
|---|---|
| Portal | `admin/index.html`, `admin/admin.js`, `admin/admin.css` (served at admin.newnormal.sg, also at `/admin/`). It has its own plain records-office look, separate from the public site's `styles.css`. |
| Setup-link page | `admin/welcome.html` (admin.newnormal.sg/welcome) |
| First Master Admin's login line | `admin/setup.html` (admin.newnormal.sg/setup) |
| Vercel functions (9 of the free plan's 12) | `api/join.js`, `api/whats-on.js`, `api/admin/session.js`, `members.js`, `org.js`, `applications.js`, `export.js`, `whats-on.js`, `accounts.js` |
| Shared code | `lib/db.js` (database and tables), `lib/auth.js` (logins and roles), `lib/org.js` (org chart roles and shape), `lib/form.js` (questions) |

### Switching it on (once)

1. **Database.** In Vercel, open the project → **Storage** → **Create Database** → **Neon** (Postgres), and connect it to this project. That sets `DATABASE_URL`. The tables are created automatically on first use.
2. **The first Master Admin.** Open `/admin/setup.html`, pick a username and password, and copy the line it gives you (the password is scrambled in your browser and never sent). In Vercel → **Settings → Environment Variables**, add `ADMIN_USERS` with that line. Master Admins set this way can't be changed from the portal, so keep it to one or two people. Everyone else gets an account from the portal.
3. **Domain.** In Vercel → **Settings → Domains**, add `admin.newnormal.sg` (and `newnormal.sg` when you move the main site there), then add the DNS record Vercel shows you at your domain registrar.
4. **Redeploy**, sign in at admin.newnormal.sg, and create the other accounts.

Optional: `FILLOUT_API_KEY` also sends a copy of each application to the old Fillout form. `ADMIN_SESSION_SECRET` (any long random text) signs the login cookies; without it one is made from `ADMIN_USERS` and the database address.

### Security and privacy

- Every permission is checked on the server; the portal only hides what you can't use.
- Sign-ins last 12 hours. 8 wrong passwords for the same username lock it for 15 minutes.
- Passwords are stored scrambled (PBKDF2). Setup links are stored only as a fingerprint, so a database leak doesn't leak working links.
- Anything people typed is shown as plain text, so nothing they type can run in the portal.
- **Deleting old applications isn't built yet.** The privacy notice promises to delete non-members' details within 3 years after recruitment closes, so that needs doing (in the Neon dashboard, or ask for a delete button).

## Fonts

The site uses one font, Bookmania, self-hosted from `assets/fonts/`. Headings and display text are set at -80 tracking (`--tracking: -0.08em`) and body text at `--tracking-body`. Both are at the top of `styles.css`.

- **The font files are in the repo** (`assets/fonts/`). The repo is public, so they can be downloaded from GitHub.
- **Regular is used across the site; Bold only on the Youth Day card.** Bold is set up as its own family (`bookmania-bold`) so it doesn't turn every heading bold. `bookmania-bold.woff2` was converted from the desktop `.otf`, so check the licence covers web use.

## Files

- `index.html`: hero, the plan (inline SVG) with each room's card text in a `<template>`, and the "Come in" footer
- `styles.css`: paper, ink and layout
- `main.js`: builds the 3D house (stacks the walls, places the room pins, runs the hover card) and renders what's on
- `events.html`: the "what's on" page (our IPs, coming up, so far)
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `#floor-art` (walls go in `#wall-art`).
2. Add a `<g class="spot" data-room="id">` hover area, an `<i class="anchor" data-room="id">` and a `<button class="pin" data-room="id">`. Use `<a>` instead for both if the room should lead somewhere.
3. Add a `<template id="tip-id">` for its card.

## To do

- [ ] Check the Bookmania licence covers web use and a public repo (see "Fonts")
- [ ] Design assets from the reviewer
- [ ] Switch on the database, the first Master Admin and admin.newnormal.sg (see "The admin portal")
- [ ] Fill in what's on in the portal: IP blurbs and images, and events
- [ ] Delete `events.js` (replaced by the portal and `whats-on.json`)

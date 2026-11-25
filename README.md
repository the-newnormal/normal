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

Normal's admin suite: people, meetings, partners and finance in one place. The sidebar has three hats, each opening with its sections as tabs across the top: **people** (members, org chart, applications), **partners & meetings**, and **finance** (claims, budgets, disbursements, bank, setup). Admins also get what's on, accounts, the activity log and privacy. Everyone signs in to **home**, which shows what needs them (their meetings and claims; claims waiting for their review; for Finance, claims to disburse; for admins, new applications and the latest activity). **Search** (top left, or press `/`) looks across everything they're allowed to see.

| Section | What's in it | Who sees it |
|---|---|---|
| members | Everyone in Normal: name, title, seats on the org chart (role + division, domain or team), Telegram, phone, email, birthday, school, joined, recruitment round, status, notes. A table (search, filter by division or team, export) and an **org chart**. | Everyone. Members see only name, title, seats and Telegram of others, see recruits as "joining", edit only their own contact details, and can't change the chart. |
| applications | Join-page applications: full answers, status (new, interviewing, accepted, declined), "accept" adds them to members. Export. | Admins |
| what's on | The IPs and events on the what's on page | Admins |
| meetings | Date, attendees, agenda, minutes, decisions | Attendees (and can write the minutes); admins |
| partners | Organisations Normal works with (PA, HDB, schools, sponsors…), status, who looks after them, their contact | The person who looks after each; admins |
| claims | Reimbursements and vendor invoices: receipts, review, approval, disbursement (see **Finance** below) | Everyone claims and sees their own; division leads review their divisions'; Finance everything |
| budgets, disbursements, bank, finance setup | Budgets with spend guidelines, funding and the reserve; paying approved claims; the bank ledger; categories and claim-form notices | Budgets: division leads (theirs) and Finance; the rest: Finance |
| accounts | Who can sign in, and as what | Master Admins |
| activity log | Every change: who, what, when, old → new. Sign-ins and account changes for Master Admins only. | Admins |
| privacy | Delete old applications (the privacy notice's 3-year promise) | Master Admins |

**Every record works the same way.** A record number (MT-0012, PT-0003…), a table with search, filters and CSV export, a page with its details and a **history & notes** timeline: every change is logged there automatically, and anyone who can see the record can leave a note (a call, a decision, an update). Admins can archive a record (hidden, not deleted) or delete it.

**Adding a module.** The modules are defined in one file, `lib/collections.js`: their fields, which appear as columns and filters, and what Members may see, add and change. Add an entry there and it appears as a tab under its `group`'s hat in the sidebar (a new group makes a new hat), with all of the above. No other code changes.

**The org chart** (members → Org chart) follows the Team Map: Normal → divisions → domains → teams, each with a code like PB or PB.1. Admins add and rename them on the chart (+ add division, + domain, + team; click a name to edit). A domain can be "overseen by" Founders, Chiefs of Staff or Directors.

- **Seats.** Someone sits on the chart through seats on their member record: a division, domain or team (or "Normal", the top) and a role (Founder, Chief of Staff, Director, Team Lead, Member, Fellow, Volunteer), with an optional note only admins see. People can hold more than one seat. Anyone without a seat is listed under "not on the chart".
- **Recruits.** Status "leaning in" / "leaning no" marks people who haven't confirmed. Admins see which (and can hide leaning-no on the chart); members just see "joining".
- **Import from Team Map** (on the chart): in the Team Map, Export CSV, then choose that file. The portal shows what's in it, then adds any new divisions, domains, teams and people and gives everyone in the file their seats, status and round from it. People are matched by name, so importing again adds nothing twice; nobody is deleted.
- A domain that is just one team of the same name shows as one card. Hover a Director to see what they oversee. A division, domain or team can only be deleted once it's empty.

**Roles.** Master Admin: everything, plus accounts, sign-ins in the log and privacy tools, and always on the Finance team. Admin: everything else except Finance's pages (unless they're on the Finance team). Member: home, the members directory and org chart, their own profile, their claims, and the modules as set in `lib/collections.js` (by default: the meetings they attend and the partners they look after).

### Finance

Rebuilt from [the-newnormal/finance](https://github.com/the-newnormal/finance) (its `CLAUDE.md` is the rulebook), inside the portal with the same login.

- **Who's who.** *Finance team*: Master Admins, plus anyone a Master Admin ticks "On the Finance team" for (accounts → the person). *Division leads*: anyone with a Founder, Chief of Staff or Director seat on an org-chart division, so the org chart decides who reviews what. *Everyone else* claims what they paid for. A login must be linked to a member record to claim (Master Admins from Vercel: "This is me").
- **A claim** goes *awaiting review* (members' claims: one approval from a lead of the budget's division, or Finance) → *awaiting Finance* (leads' and Finance's own claims start here) → *approved* → *reimbursed* (or *settled*, for a vendor invoice), or *rejected* with a reason the claimant sees. Nobody reviews their own claim, except that Finance may finalise its own. Vendor invoices: leads and Finance only. Every step is on the claim's timeline, with notes.
- **Receipts** (1–5 per claim, photos or PDFs up to 3.5 MB; big photos are shrunk in the browser) are stored in the database. Only the claimant, the division's leads and Finance can open them.
- **Payout details** (PayNow mobile or UEN, or a bank account) are encrypted (AES-256-GCM, the claimant as additional data) with `PAYOUT_ENCRYPTION_KEY`; everyone but Finance sees only the last four characters. People can save theirs for next time.
- **Disbursements.** Finance opens an approved claim for a **PayNow QR** (payee, amount and the reference `NN-C00012` filled in), pays in the bank app, then records the disbursement: which account, the bank reference, the date. That takes it off the account in the ledger.
- **Budgets** live in a division and provide some of the 15 spend categories (in 5 groups: Venue & Production, Programme, People, Marketing & Brand, Operations & Admin), each with a guideline amount; claims can only use a budget's categories. Leads and Finance see spending against each guideline. **Available** = grants received + loans from the reserve − repayments − approved and disbursed claims. A short balance never blocks a claim; Finance gets a warning.
- **The reserve** is the budget outside every division: Finance adds to it, claims against it and lends from it.
- **Bank.** Accounts with an opening balance and an append-only ledger (money in, adjustments, transfers, disbursements). Type in the DBS balance to compare; "Match it" adds the adjustment. Mistakes are corrected with an adjustment, never edited.
- **Not in the portal yet** (still in the finance app): claim emails, AI receipt checks, importing claims paid before the portal, and editing ledger entries with a reason. Claims in the finance app aren't copied across.

**Giving someone a login.** accounts → create an account (or "make them a login" on their member profile). Pick their role and their member profile. You get a one-time link to send on WhatsApp or Telegram; they open it and choose their own password. Links work once and last 7 days. If someone forgets their password, open their account → new password link.

**Taking access away.** Disable or delete the account, or change their role. Any of these signs them out straight away.

`join.html` is the recruitment form, rebuilt from the Fillout form. The questions live in `join-form.json`; edit them there and the page, the database and the admin all follow. Each question's `id` is its Fillout question ID, so keep those as they are.

| Piece | Where |
|---|---|
| Portal | `admin/index.html`, `admin/admin.js`, `admin/admin.css`, `admin/teammap.js` (served at admin.newnormal.sg, also at `/admin/`). It has its own plain records-office look, separate from the public site's `styles.css`. |
| Setup-link page | `admin/welcome.html` (admin.newnormal.sg/welcome) |
| First Master Admin's login line | `admin/setup.html` (admin.newnormal.sg/setup) |
| Vercel functions (all 12 of the free plan's 12) | `api/join.js`, `api/whats-on.js`, `api/admin/session.js`, `members.js`, `org.js`, `applications.js`, `export.js`, `whats-on.js`, `accounts.js`, `records.js` (every module), `home.js` (home, search, activity log, notes), `finance.js` (claims, budgets, disbursements, bank). To add another, fold `export.js` into `applications.js` first. |
| Shared code | `lib/finance.js` (finance rules, encryption, PayNow), `lib/collections.js` (the modules), `lib/records.js` (their rules), `lib/activity.js` (the log), `lib/db.js` (database and tables), `lib/auth.js` (logins and roles), `lib/org.js` (org chart roles and shape), `lib/form.js` (questions) |

### Switching it on (once)

1. **Database.** In Vercel, open the project → **Storage** → **Create Database** → **Neon** (Postgres), and connect it to this project. That sets `DATABASE_URL`. The tables are created automatically on first use.
2. **The first Master Admin.** Open `/admin/setup.html`, pick a username and password, and copy the line it gives you (the password is scrambled in your browser and never sent). In Vercel → **Settings → Environment Variables**, add `ADMIN_USERS` with that line. Master Admins set this way can't be changed from the portal, so keep it to one or two people. Everyone else gets an account from the portal. Once signed in, open your own member record and press **This is me**, so home shows your tasks and meetings.
3. **Domain.** In Vercel → **Settings → Domains**, add `admin.newnormal.sg` (and `newnormal.sg` when you move the main site there), then add the DNS record Vercel shows you at your domain registrar.
4. **Redeploy**, sign in at admin.newnormal.sg, and create the other accounts.

**Finance needs `PAYOUT_ENCRYPTION_KEY`** (Vercel → Settings → Environment Variables, marked Sensitive): 32 random bytes in base64. Make one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and keep a copy in a password manager: payout details saved under a lost key can't be read again. Until it's set, claims can't be sent.

Optional: `FILLOUT_API_KEY` also sends a copy of each application to the old Fillout form. `ADMIN_SESSION_SECRET` (any long random text) signs the login cookies; without it one is made from `ADMIN_USERS` and the database address.

### Security and privacy

- Every permission is checked on the server; the portal only hides what you can't use.
- Sign-ins last 12 hours. 8 wrong passwords for the same username lock it for 15 minutes.
- Passwords are stored scrambled (PBKDF2). Setup links are stored only as a fingerprint, so a database leak doesn't leak working links.
- Anything people typed is shown as plain text, so nothing they type can run in the portal.
- Every change is in the activity log. Deleting a member removes their notes and their name from the log.
- **Privacy** (Master Admins): delete applications from people who didn't join, submitted before a date (the privacy notice promises this within 3 years after recruitment closes), or a single application.

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

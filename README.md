# Normal: website

A home built for us to be human. The home page has three parts: a hero, a hand-drawn floor plan tilted into 3D, and a "Come in" footer with contact links. Hover over a room (or tap it on a phone) to see a short card about it. The front door leads to "Come in", and the library leads to the events page.

Pages: `index.html` (home) and `events.html` (all events).

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

Everything on the "what's on" page (`events.html`) comes from `events.js`.

- **Our IPs** (`NORMAL_IPS`): `name`, `kicker`, `blurb`, `link` (its own site, e.g. `https://youthday.sg`) and `image`. `theme: "backyard"` or `"youthday"` dresses the card like that IP's own site (colours and fonts taken from backyard.sg and youthday.sg; the fonts load from Google Fonts on `events.html` only). An IP with no theme gets a plain Normal card, and one with no link shows "page coming soon". Put images in `assets/ips/`.
- **Events** (`NORMAL_EVENTS`): see below. Put photos in `assets/events/`.

```js
{ title: "Youth Day", date: "2026-12-12", time: "2pm – 8pm", place: "…", blurb: "…",
  link: "https://…",          // sign-up, shown while upcoming
  recap: "https://…",         // shown once it's past
  image: "assets/events/youth-day.jpg" }
```

## Fonts

The site uses one font, Bookmania, self-hosted from `assets/fonts/`. Headings and display text are set at -80 tracking (`--tracking: -0.08em`) and body text at `--tracking-body`. Both are at the top of `styles.css`.

- **The font files are not in git.** Bookmania is licensed and this repo is public, so `assets/fonts/` is in `.gitignore`. Copy `bookmania-regular.woff2`, `bookmania-regular.woff` and `bookmania-bold.woff2` into `assets/fonts/` wherever you deploy from.
- **Regular is used across the site; Bold only on the Youth Day card.** Bold is set up as its own family (`bookmania-bold`) so it doesn't turn every heading bold. `bookmania-bold.woff2` was converted from the desktop `.otf`, so check the licence covers web use.

## Files

- `index.html`: hero, the plan (inline SVG) with each room's card text in a `<template>`, and the "Come in" footer
- `styles.css`: paper, ink and layout
- `main.js`: builds the 3D house (stacks the walls, places the room pins, runs the hover card) and renders events
- `events.html`: the "what's on" page (our IPs, coming up, so far)
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `#floor-art` (walls go in `#wall-art`).
2. Add a `<g class="spot" data-room="id">` hover area, an `<i class="anchor" data-room="id">` and a `<button class="pin" data-room="id">`. Use `<a>` instead for both if the room should lead somewhere.
3. Add a `<template id="tip-id">` for its card.

## To do

- [ ] Check the Bookmania licence covers web use, and decide how the font files get to the live site (see "Fonts")
- [ ] Design assets from the reviewer
- [ ] Fill in `events.js`: IP blurbs and images, and events
- [ ] Real Instagram and email links (in `index.html`, marked `TODO`)

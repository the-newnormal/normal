# Normal: website

A home built for us to be human. The home page has three parts: a hero, a hand-drawn floor plan tilted into 3D, and a "Come in" footer with contact links. Hover over a room (or tap it on a phone) to see a short card about it. The front door leads to "Come in", and the library leads to the events page.

Pages: `index.html` (home) and `events.html` (all events).

| Part of the plan | What its card says |
|---|---|
| Front door | Who we stand for |
| 1 Kitchen | A laboratory · *Adventure, not fear* · Courage to explore |
| 2 Living room | A seat at the table · *Considered, not dismissed* · Authenticity & intention |
| 3 Bedroom | A shelter · *Dwelling, not rushing* |
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

## Add an event

Edit `events.js`. Every event shows up on `events.html`. Put photos in `assets/events/`.

```js
{ title: "Youth Day", date: "2026-12-12", time: "2pm – 8pm", place: "…", blurb: "…",
  link: "https://…",          // sign-up, shown while upcoming
  recap: "https://…",         // shown once it's past
  image: "assets/events/youth-day.jpg" }
```

## Change the fonts

There are two variables at the top of `styles.css`: `--hand` (headings and labels) and `--serif` (body text). Also update the Google Fonts `<link>` in `index.html` and `events.html`.

## Files

- `index.html`: hero, the plan (inline SVG) with each room's card text in a `<template>`, and the "Come in" footer
- `styles.css`: paper, ink and layout
- `main.js`: builds the 3D house (stacks the walls, places the room pins, runs the hover card) and renders events
- `events.html`: the events page
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `#floor-art` (walls go in `#wall-art`).
2. Add a `<g class="spot" data-room="id">` hover area, an `<i class="anchor" data-room="id">` and a `<button class="pin" data-room="id">`. Use `<a>` instead for both if the room should lead somewhere.
3. Add a `<template id="tip-id">` for its card.

## To do

- [ ] Fonts from the reviewer (see "Change the fonts")
- [ ] Design assets from the reviewer
- [ ] Fill in `events.js`
- [ ] Real Instagram and email links (in `index.html`, marked `TODO`)
- [ ] The doc leaves *Dwelling // ___* blank, so "Rushing" is a placeholder

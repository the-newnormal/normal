# Normal: website

A home built for us to be human. It's a scrolling page with a hand-drawn floor plan in the middle, tilted into 3D. Hover over a room (or tap it on a phone) to see a short description. Click it to jump to its full section below.

Pages: `index.html` (home) and `events.html` (all events).

| Part of the plan | What's in it |
|---|---|
| Front door | Who we stand for, plus Instagram and email links |
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

Edit `events.js`. Every event shows up on `events.html`. The next three upcoming ones also show on the home page's Library shelves. Put photos in `assets/events/`.

```js
{ title: "Youth Day", date: "2026-12-12", time: "2pm – 8pm", place: "…", blurb: "…",
  link: "https://…",          // sign-up, shown while upcoming
  recap: "https://…",         // shown once it's past
  image: "assets/events/youth-day.jpg" }
```

## Change the fonts

There are two variables at the top of `styles.css`: `--hand` (headings and labels) and `--serif` (body text). Also update the Google Fonts `<link>` in `index.html` and `events.html`.

## Files

- `index.html`: hero, the plan (inline SVG), then one `<section>` per room (`#door`, `#kitchen`…)
- `styles.css`: paper, ink and layout
- `main.js`: builds the 3D house (stacks the walls, places the room pins, runs the hover card), copies the plan into each room's "detail" crop, and renders events
- `events.html`: the events page
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `#floor-art` (walls go in `#wall-art`).
2. Add an `<a class="spot" data-room="id">` hover area, an `<i class="anchor" data-room="id">` and an `<a class="pin" data-room="id">`.
3. Add a `<template id="tip-id">` for its hover card.
4. Add a `<section class="room" id="id">`. Its detail is an `<svg data-crop viewBox="…">` framing that part of the plan.

## To do

- [ ] Fonts from the reviewer (see "Change the fonts")
- [ ] Design assets from the reviewer
- [ ] Fill in `events.js`
- [ ] Real Instagram and email links (in `index.html`, marked `TODO`)
- [ ] The doc leaves *Dwelling // ___* blank, so "Rushing" is a placeholder

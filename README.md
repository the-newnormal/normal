# Normal: website

A home built for us to be human. It's a scrolling page with a hand-drawn floor plan in the middle. Click a room on the plan to jump to its section below.

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

Edit `events.js`. Events show up on the Library's shelves. Upcoming events are listed first, and past ones are greyed out.

```js
{ title: "Youth Day", date: "2026-12-12", time: "2pm – 8pm", place: "…", blurb: "…", link: "https://…" }
```

## Files

- `index.html`: hero, the plan (inline SVG), then one `<section>` per room (`#door`, `#kitchen`…)
- `styles.css`: paper, ink and layout
- `main.js`: copies the plan drawing into each room's "detail" crop, plus the door, events and scroll-in
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `#plan-art` in the plan.
2. Add an `<a class="spot" href="#id">` hit area.
3. Add a `<section class="room" id="id">`. Its detail is an `<svg data-crop viewBox="…">` framing that part of the plan.

## To do

- [ ] Real Instagram and email links (in `index.html`, marked `TODO`)
- [ ] The doc leaves *Dwelling // ___* blank, so "Rushing" is a placeholder

# Normal: website

A home built for us to be human. The site is one hand-drawn floor plan. Click a room to step inside.

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

- `index.html`: the plan (inline SVG) and each room's notes (`<article id="kitchen">` etc.)
- `styles.css`: paper, ink and layout (side panel on desktop, bottom sheet on phones)
- `main.js`: room navigation (`#kitchen` links work), zoom, the door, events
- `assets/`: wordmark and door mark (traced to SVG from the hand-drawn originals), house sketch

To add a part of the house:

1. Draw it inside `.plan__ink`.
2. Add an `<a class="spot" href="#id">` hit area.
3. Add an `<article class="note" id="id" data-panel>`.
4. Add its zoom box to `ZOOM` in `main.js`.

## To do

- [ ] Real Instagram and email links (in `index.html`, marked `TODO`)
- [ ] The doc leaves *Dwelling // ___* blank, so "Rushing" is a placeholder

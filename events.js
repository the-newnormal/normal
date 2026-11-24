/*
  Everything on the "what's on" page (events.html) comes from this file.

  ── Our IPs ──
  Each IP:
    name   (required)  "Backyard"
    blurb              "One line on what it is"
    link               its page: "backyard.html", or a full "https://…" address
    image              "assets/ips/…"   a photo or poster (put the file in assets/ips/)

  An IP with no link shows "page coming soon" and isn't clickable.
*/
window.NORMAL_IPS = [
  { name: "Backyard", blurb: "", link: "https://backyard.sg", image: "" },
  { name: "Youth Day", blurb: "", link: "https://youthday.sg", image: "" },
  { name: "Living Archive", blurb: "", link: "", image: "" },
];

/*
  ── Events ──
  Each event:
    title  (required)  "Youth Day"
    date   (required)  "YYYY-MM-DD"
    time               "2pm – 8pm"
    place              "Where it is"
    blurb              "One line on what it is"
    link               "https://…"         sign-up link, shown while it's upcoming
    recap              "https://…"         photos / write-up, shown once it's past
    image              "assets/events/…"   a photo (put the file in assets/events/)

  Upcoming events are listed soonest first; past ones newest first.
*/
window.NORMAL_EVENTS = [
  // {
  //   title: "Event name",
  //   date: "2026-12-12",
  //   time: "2pm – 8pm",
  //   place: "Somewhere in Singapore",
  //   blurb: "One line on what it is.",
  //   link: "https://example.com/sign-up",
  //   recap: "https://instagram.com/p/…",
  //   image: "assets/events/event-name.jpg"
  // },
];

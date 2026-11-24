/*
  Everything on the "what's on" page (events.html) comes from this file.

  ── Our IPs ──
  Each IP:
    name   (required)  "Backyard"
    blurb              "One line on what it is"
    link               its page: "backyard.html", or a full "https://…" address
    image              "assets/ips/…"   a photo or poster (put the file in assets/ips/)
    theme              "backyard" or "youthday": dresses the card like that IP's own site
    kicker             small line above the name

  An IP with no link shows "page coming soon" and isn't clickable.
*/
window.NORMAL_IPS = [
  { name: "Backyard", theme: "backyard", kicker: "we invite you to our", blurb: "community bbq", link: "https://backyard.sg" },
  { name: "Youth Day", theme: "youthday", kicker: "5 & 6 July 2026", blurb: "will return in 2027", link: "https://youthday.sg" },
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

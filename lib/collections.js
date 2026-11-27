// The admin suite's modules. Each one is a list of records with the same tools: a table with filters
// and search, a record page, a history-and-notes timeline, CSV export and the role rules below.
// To add a module, add an entry here. Nothing else needs to change.
//
// group: the sidebar entry (hat) the module sits under; modules with the same group share one.
// pickerSub: a field shown after the title in pickers ("Ms Tan · HDB").
// chart: the record page draws an org chart of the record, the parts under it (`parent` links), the
//        people at each part (`people`) and the meetings with any of them (`meetings`).
//
// Fields: { key, label, type, required, options, list (show as a column), filter (show as a filter), wide, hint,
//          today (a date that starts as today), mine (a unit that starts as the creator's team),
//          inherit: [linkField, field] (starts as that field of the linked record), quickAdd (add new ones in place),
//          fromManagers (a person from the managing team, below), oneEach (each person on one record at most),
//          narrowBy: "<links field>" (once something is ticked there, list only the records at it and the parts under it),
//          meDefault (a new record starts with whoever adds it), section (a heading before it on the form),
//          requiredOnce: "<date field>" (needed once that date is today or past: a meeting's notes, once it's happened),
//          more (folded under "More details" on the form), reveal: "<link text>" (an optional field left empty shows as that link) }
// steps: [{ title, fields }] adds a record a page at a time (a meeting: who, when and where, notes).
// formOrder: the order of the form's fields (default: as listed). newLabel: the "+ new" button's words.
// pickerHide: { field, values } records pickers leave out (unless already picked), e.g. contacts who moved on.
// autoTitle: { prefix, from } names a record left unnamed after its links ("Meeting with Example Board").
//   types: text, long, date, number, money (SGD), select (options), check, url, email, phone,
//          member (one person), members (several people), unit (a division, domain or team),
//          link (a record in another module: to: "<module key>"), links (several records in another module)
//
// Who sees what: Master Admins and Admins see and edit everything. For Members, `members` says:
//   see:    "all" (every record) or "own" (only records they own)
//   own:    the fields that make a record theirs: a person field that includes them, or a unit field (our team)
//           in their part of the org chart: the teams they sit in, everything under them and the units above them
//   where:  only records whose field matches, e.g. { field: "audience", values: ["everyone"] }
//   create: fields they can fill in when adding a record (leave out to stop them adding)
//   edit:   fields they can change on records they own
//   lock:   once this field has one of these values, they can't change the record any more
//   managers: { setting, label?, when? } the team an admin marks on the org chart (its unit page) manages every
//           record (or those where `when` is filled in): everyone in that part of the org chart can see and change them
// No `members` entry means Members don't see the module at all.

const LEVELS = ["top leadership", "senior", "middle", "officer", "ground"];
const all = (fields) => fields.map((f) => f.key);

const PARTNER_FIELDS = [
  { key: "name", label: "Organisation", type: "text", required: true, list: true },
  { key: "parent", label: "Part of", type: "link", to: "partners", list: true, filter: true,
    hint: "For a department, branch or outlet of a bigger partner (a CC under PA, a department under HDB). Leave empty for a whole organisation." },
  { key: "kind", label: "Kind", type: "select", options: ["government", "statutory board", "grassroots", "school", "company", "community group", "venue", "media", "funder", "other"], list: true, filter: true },
  { key: "status", label: "Status", type: "select", options: ["prospect", "talking", "active", "paused", "past"], list: true, filter: true },
  { key: "team", label: "Our team", type: "unit", list: true, filter: true, mine: true, hint: "The team that looks after this relationship. Everyone in that part of the org chart can update it." },
  { key: "lead", label: "Relationships lead", type: "member", list: true, filter: true, fromManagers: true, oneEach: true,
    hint: "The Relationships member who looks after this partnership. Each looks after one." },
  { key: "owner", label: "Our contact person", type: "member", filter: true, hint: "Who works with them day to day, if not the Relationships lead." },
  { key: "next_step", label: "Next step", type: "text" },
  { key: "next_date", label: "Next step by", type: "date" },
  { key: "website", label: "Website", type: "url" },
  { key: "notes", label: "Notes", type: "long", wide: true, hint: "What they want, what we've agreed, how they work. Log each meeting under meetings." },
];
const CONTACT_FIELDS = [
  { key: "name", label: "Name", type: "text", required: true, list: true },
  { key: "partner", label: "Organisation", type: "link", to: "partners", required: true, list: true, filter: true,
    hint: "The most specific part they work in: the CC rather than PA, if you know it." },
  { key: "title", label: "Their role", type: "text", list: true },
  { key: "level", label: "Level", type: "select", options: LEVELS, list: true, filter: true,
    hint: "Top leadership (CEO, director), senior (deputy director, head of department), middle (manager), officer (executive), ground (frontline staff, volunteers)." },
  { key: "reports_to", label: "Reports to", type: "link", to: "contacts", hint: "Their manager, if you know: this draws the partner's org chart." },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "phone" },
  { key: "telegram", label: "Telegram", type: "text" },
  { key: "linkedin", label: "LinkedIn", type: "url" },
  { key: "status", label: "Status", type: "select", options: ["current", "moved on"], required: true, list: true, filter: true,
    hint: "Moved on: they've left the role. They stay here, with every meeting we had with them." },
  { key: "team", label: "Our team", type: "unit", filter: true, inherit: ["partner", "team"], mine: true },
  { key: "owner", label: "Who knows them best", type: "member", filter: true },
  { key: "notes", label: "Notes", type: "long", wide: true },
];
const MEETING_FIELDS = [
  { key: "title", label: "Name", type: "text", list: true, hint: "Leave it empty to call it \"Meeting with\" the organisations." },
  { key: "date", label: "Date", type: "date", required: true, list: true, today: true, section: "when and where" },
  { key: "time", label: "Time", type: "text", hint: "e.g. 7–9pm" },
  { key: "place", label: "Where", type: "text", hint: "A place, or a call link." },
  { key: "partners", label: "Organisation", type: "links", to: "partners", list: true, filter: true, wide: true, section: "who",
    hint: "Who the meeting was with. Leave it empty for an internal meeting." },
  { key: "contacts", label: "Their side", type: "links", to: "contacts", wide: true, quickAdd: true, narrowBy: "partners",
    hint: "Everyone from their side who was there. Someone new? Type their name and add them: they're kept as a contact." },
  { key: "attendees", label: "Our side", type: "members", list: true, filter: true, meDefault: true },
  { key: "team", label: "Our team", type: "unit", list: true, filter: true, reveal: "+ add our team",
    hint: "Optional: the team the meeting belongs to. Its part of the org chart can then see the notes." },
  { key: "minutes", label: "Meeting notes", type: "long", wide: true, section: "notes", requiredOnce: "date",
    hint: "What was discussed, what was agreed, what happens next. Needed once the meeting has happened." },
  { key: "agenda", label: "Agenda", type: "long", wide: true, reveal: "+ add an agenda" },
];

const COLLECTIONS = {
  partners: {
    label: "partners", noun: "partner", prefix: "PT", group: "partners & meetings", icon: "handshake",
    title: "name", sort: ["name", "asc"], due: "next_date", overdue: "next_date", pickerSub: "parent",
    chart: { parent: "parent", people: { c: "contacts", at: "partner", reportsTo: "reports_to", level: "level", levels: LEVELS }, meetings: { c: "meetings", orgs: "partners", people: "contacts" } },
    fields: PARTNER_FIELDS,
    defaults: { status: "prospect" },
    // everyone sees who Normal works with (so no one cold-calls a partner another team already knows); their team updates it
    members: { see: "all", own: ["owner", "lead", "team"], create: all(PARTNER_FIELDS), edit: all(PARTNER_FIELDS),
      managers: { setting: "partners", label: "Looks after every partner (with their contacts, and the meetings with them)" } },
  },

  contacts: {
    label: "contacts", noun: "contact", prefix: "CT", group: "partners & meetings", icon: "members",
    title: "name", sort: ["name", "asc"], pickerSub: "partner", pickerHide: { field: "status", values: ["moved on"] },
    fields: CONTACT_FIELDS,
    defaults: { status: "current" },
    members: { see: "all", own: ["owner", "team"], create: all(CONTACT_FIELDS), edit: all(CONTACT_FIELDS), managers: { setting: "partners" } },
  },

  meetings: {
    label: "meetings", noun: "meeting", prefix: "MT", group: "partners & meetings", icon: "chat",
    title: "title", sort: ["date", "desc"], due: "date", newLabel: "log a meeting",
    autoTitle: { prefix: "Meeting with ", from: "partners" },
    formOrder: ["partners", "contacts", "attendees", "team", "date", "time", "place", "title", "minutes", "agenda"],
    steps: [
      { title: "who", fields: ["partners", "contacts", "attendees", "team"] },
      { title: "when and where", fields: ["date", "time", "place", "title"] },
      { title: "notes", fields: ["minutes", "agenda"] },
    ],
    fields: MEETING_FIELDS,
    // minutes stay with the people who were there and the team the meeting belongs to
    members: { see: "own", own: ["attendees", "team"], create: all(MEETING_FIELDS), edit: all(MEETING_FIELDS), managers: { setting: "partners", when: "partners" } },
  },
};

module.exports = { COLLECTIONS };

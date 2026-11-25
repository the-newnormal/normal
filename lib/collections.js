// The admin suite's modules. Each one is a list of records with the same tools: a table with filters
// and search, a record page, a history-and-notes timeline, CSV export and the role rules below.
// To add a module, add an entry here. Nothing else needs to change.
//
// group: the sidebar entry (hat) the module sits under; modules with the same group share one.
//
// Fields: { key, label, type, required, options, list (show as a column), filter (show as a filter), wide, hint,
//          today (a date that starts as today) }
//   types: text, long, date, number, money (SGD), select (options), check, url, email, phone,
//          member (one person), members (several people), unit (a division, domain or team),
//          link (a record in another module: to: "<module key>")
//
// Who sees what: Master Admins and Admins see and edit everything. For Members, `members` says:
//   see:    "all" (every record) or "own" (records where one of the `own` fields includes them)
//   where:  only records whose field matches, e.g. { field: "audience", values: ["everyone"] }
//   create: fields they can fill in when adding a record (leave out to stop them adding)
//   edit:   fields they can change on records they own
//   lock:   once this field has one of these values, they can't change the record any more
// No `members` entry means Members don't see the module at all.

const COLLECTIONS = {
  partners: {
    label: "partners", noun: "partner", prefix: "PT", group: "partners & meetings", icon: "handshake",
    title: "name", sort: ["name", "asc"],
    fields: [
      { key: "name", label: "Organisation", type: "text", required: true, list: true },
      { key: "kind", label: "Kind", type: "select", options: ["government", "school", "company", "community", "venue", "media", "funder", "other"], list: true, filter: true },
      { key: "status", label: "Status", type: "select", options: ["prospect", "talking", "active", "paused", "past"], list: true, filter: true },
      { key: "owner", label: "Our contact person", type: "member", list: true, filter: true },
      { key: "contact", label: "Their contact", type: "text", list: true },
      { key: "contact_role", label: "Their role", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "phone" },
      { key: "website", label: "Website", type: "url" },
      { key: "notes", label: "Notes", type: "long", wide: true, hint: "Log calls and meetings as notes on the record's timeline." },
    ],
    defaults: { status: "prospect", kind: "community" },
    members: { see: "own", own: ["owner"], edit: ["status", "contact", "contact_role", "email", "phone", "notes"] },
  },

  meetings: {
    label: "meetings", noun: "meeting", prefix: "MT", group: "partners & meetings", icon: "chat",
    title: "title", sort: ["date", "desc"], due: "date",
    fields: [
      { key: "title", label: "Meeting", type: "text", required: true, list: true },
      { key: "date", label: "Date", type: "date", required: true, list: true },
      { key: "time", label: "Time", type: "text", hint: "e.g. 7–9pm" },
      { key: "place", label: "Where", type: "text", hint: "A place, or a call link." },
      { key: "team", label: "Team", type: "unit", list: true, filter: true },
      { key: "attendees", label: "Attendees", type: "members", list: true, filter: true },
      { key: "agenda", label: "Agenda", type: "long", wide: true },
      { key: "minutes", label: "Minutes", type: "long", wide: true },
      { key: "decisions", label: "Decisions", type: "long", wide: true },
    ],
    members: { see: "own", own: ["attendees"], edit: ["minutes", "decisions"] },
  },

};

module.exports = { COLLECTIONS };

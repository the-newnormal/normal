// The admin suite's modules. Each one is a list of records with the same tools: a table with filters
// and search, a record page, a history-and-notes timeline, CSV export and the role rules below.
// To add a module, add an entry here. Nothing else needs to change.
//
// Fields: { key, label, type, required, options, list (show as a column), filter (show as a filter), wide, hint,
//          today (a date that starts as today) }
//   types: text, long, date, number, money (SGD), select (options), check, url, email, phone,
//          member (one person), members (several people), unit (a division, domain or team),
//          link (a record in another module: to: "projects")
//
// Who sees what: Master Admins and Admins see and edit everything. For Members, `members` says:
//   see:    "all" (every record) or "own" (records where one of the `own` fields includes them)
//   where:  only records whose field matches, e.g. { field: "audience", values: ["everyone"] }
//   create: fields they can fill in when adding a record (leave out to stop them adding)
//   edit:   fields they can change on records they own
//   lock:   once this field has one of these values, they can't change the record any more
// No `members` entry means Members don't see the module at all.

const COLLECTIONS = {
  tasks: {
    label: "tasks", noun: "task", prefix: "T", group: "Work", icon: "check",
    title: "title", sort: ["due", "asc"], due: "due", done: { field: "status", values: ["done"] },
    fields: [
      { key: "title", label: "Task", type: "text", required: true, list: true },
      { key: "status", label: "Status", type: "select", options: ["to do", "doing", "blocked", "done"], list: true, filter: true },
      { key: "priority", label: "Priority", type: "select", options: ["low", "normal", "high", "urgent"], list: true, filter: true },
      { key: "due", label: "Due", type: "date", list: true },
      { key: "assignees", label: "Assigned to", type: "members", list: true, filter: true },
      { key: "team", label: "Team", type: "unit", list: true, filter: true },
      { key: "project", label: "Event / project", type: "link", to: "projects", list: true, filter: true },
      { key: "details", label: "Details", type: "long", wide: true },
    ],
    defaults: { status: "to do", priority: "normal" },
    members: {
      see: "own", own: ["assignees"],
      create: ["title", "priority", "due", "assignees", "team", "project", "details"],
      edit: ["status", "details"],
    },
  },

  projects: {
    label: "events & projects", noun: "event or project", prefix: "P", group: "Work", icon: "flag",
    title: "name", sort: ["start", "desc"], due: "start", done: { field: "status", values: ["done", "cancelled"] },
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Kind", type: "select", options: ["event", "project", "programme", "campaign"], list: true, filter: true },
      { key: "status", label: "Status", type: "select", options: ["idea", "planning", "confirmed", "live", "done", "cancelled"], list: true, filter: true },
      { key: "start", label: "Starts", type: "date", list: true },
      { key: "end", label: "Ends", type: "date" },
      { key: "team", label: "Team", type: "unit", list: true, filter: true },
      { key: "lead", label: "Lead", type: "member", list: true, filter: true },
      { key: "people", label: "People", type: "members" },
      { key: "venue", label: "Venue", type: "text" },
      { key: "budget", label: "Budget", type: "money", list: true },
      { key: "attendance", label: "Attendance", type: "number", hint: "How many came, once it's over." },
      { key: "folder", label: "Folder / doc", type: "url" },
      { key: "summary", label: "Summary", type: "long", wide: true },
    ],
    defaults: { kind: "event", status: "idea" },
    members: { see: "all" },
  },

  meetings: {
    label: "meetings", noun: "meeting", prefix: "MT", group: "Work", icon: "chat",
    title: "title", sort: ["date", "desc"], due: "date",
    fields: [
      { key: "title", label: "Meeting", type: "text", required: true, list: true },
      { key: "date", label: "Date", type: "date", required: true, list: true },
      { key: "time", label: "Time", type: "text", hint: "e.g. 7–9pm" },
      { key: "place", label: "Where", type: "text", hint: "A place, or a call link." },
      { key: "team", label: "Team", type: "unit", list: true, filter: true },
      { key: "project", label: "Event / project", type: "link", to: "projects", filter: true },
      { key: "attendees", label: "Attendees", type: "members", list: true, filter: true },
      { key: "agenda", label: "Agenda", type: "long", wide: true },
      { key: "minutes", label: "Minutes", type: "long", wide: true },
      { key: "decisions", label: "Decisions", type: "long", wide: true },
    ],
    members: { see: "own", own: ["attendees"], edit: ["minutes", "decisions"] },
  },

  partners: {
    label: "partners", noun: "partner", prefix: "PT", group: "Outreach", icon: "handshake",
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

  finance: {
    label: "finance", noun: "entry", prefix: "F", group: "Money", icon: "coin",
    title: "item", sort: ["date", "desc"], totals: { amount: "amount", by: "type" },
    fields: [
      { key: "item", label: "What for", type: "text", required: true, list: true },
      { key: "type", label: "Type", type: "select", options: ["expense", "income", "budget"], list: true, filter: true, hint: "Budget: money set aside but not spent yet." },
      { key: "amount", label: "Amount", type: "money", required: true, list: true },
      { key: "date", label: "Date", type: "date", list: true, today: true },
      { key: "status", label: "Status", type: "select", options: ["planned", "submitted", "approved", "paid", "received", "rejected"], list: true, filter: true },
      { key: "category", label: "Category", type: "select", options: ["food", "venue", "printing", "transport", "merch", "equipment", "marketing", "sponsorship", "grant", "donation", "tickets", "other"], list: true, filter: true },
      { key: "project", label: "Event / project", type: "link", to: "projects", list: true, filter: true },
      { key: "claimant", label: "Paid by / claimant", type: "member", list: true, filter: true },
      { key: "receipt", label: "Receipt / invoice", type: "url", hint: "A link to the photo or PDF (e.g. in Google Drive)." },
      { key: "notes", label: "Notes", type: "long", wide: true },
    ],
    defaults: { type: "expense", status: "submitted" },
    members: {
      see: "own", own: ["claimant"],
      create: ["item", "amount", "date", "category", "project", "receipt", "notes"],
      edit: ["item", "amount", "date", "category", "project", "receipt", "notes"],
      lock: { field: "status", values: ["approved", "paid", "received", "rejected"] },
      createDefaults: { type: "expense", status: "submitted" },
    },
  },

  documents: {
    label: "library", noun: "document", prefix: "D", group: "Library", icon: "book",
    title: "title", sort: ["title", "asc"],
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "kind", label: "Kind", type: "select", options: ["guide", "SOP", "template", "deck", "form", "policy", "minutes", "other"], list: true, filter: true },
      { key: "link", label: "Link", type: "url", required: true, list: true },
      { key: "team", label: "Team", type: "unit", list: true, filter: true },
      { key: "owner", label: "Kept up to date by", type: "member" },
      { key: "audience", label: "Who can see it", type: "select", options: ["everyone", "admins"], list: true, filter: true },
      { key: "summary", label: "Summary", type: "long", wide: true },
    ],
    defaults: { kind: "guide", audience: "everyone" },
    members: { see: "all", where: { field: "audience", values: ["everyone"] } },
  },

  announcements: {
    label: "announcements", noun: "announcement", prefix: "AN", group: "Library", icon: "megaphone",
    title: "title", sort: ["date", "desc"],
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "date", label: "Date", type: "date", list: true, today: true },
      { key: "audience", label: "Who can see it", type: "select", options: ["everyone", "admins"], list: true, filter: true },
      { key: "pinned", label: "Pin to the top of home", type: "check", list: true },
      { key: "body", label: "Message", type: "long", required: true, wide: true },
    ],
    defaults: { audience: "everyone", pinned: false },
    members: { see: "all", where: { field: "audience", values: ["everyone"] } },
  },
};

module.exports = { COLLECTIONS };

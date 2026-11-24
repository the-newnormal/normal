// The org chart's shape, shared by the members and org endpoints.
// Normal → divisions → domains → teams. People hold seats: a unit (or the top, for none) and a role.
// Someone can hold more than one seat. Roles, structure and statuses follow Normal's Team Map.

const ROLES = ["Founder", "Chief of Staff", "Director", "Team Lead", "Member", "Fellow", "Volunteer"];
const OVERSEER_ROLES = ["Founder", "Chief of Staff", "Director"]; // can oversee a domain
const KINDS = ["division", "domain", "team"];
// which kind of unit each kind may sit under (null = the top)
const PARENT_KINDS = { division: [null], domain: ["division"], team: ["division", "domain"] };

// "leaning in" / "leaning no": recruits who haven't confirmed yet. Only admins see which; members see "joining".
const STATUSES = ["active", "leaning in", "leaning no", "on break", "alumni"];
const LEANING = ["leaning in", "leaning no"];
const publicStatus = (s) => (LEANING.includes(s) ? "joining" : s);

const roleRank = (r) => {
  const i = ROLES.indexOf(r);
  return i < 0 ? 99 : i;
};
const topRole = (seats) => (seats || []).map((s) => s.role).sort((a, b) => roleRank(a) - roleRank(b))[0] || null;

module.exports = { ROLES, OVERSEER_ROLES, KINDS, PARENT_KINDS, STATUSES, LEANING, publicStatus, roleRank, topRole };

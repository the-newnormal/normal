// The org chart's shape, shared by the members and org endpoints.
// Normal → divisions → domains → teams. Each member has a role and (optionally) a seat on one unit.
// Roles and structure follow Normal's Team Map.

const ROLES = ["Founder", "Chief of Staff", "Director", "Team Lead", "Member", "Fellow", "Volunteer"];
const LEADERSHIP = ["Founder", "Chief of Staff"]; // sit at the top when they have no seat
const OVERSEER_ROLES = ["Founder", "Chief of Staff", "Director"]; // can oversee a domain
const KINDS = ["division", "domain", "team"];
// which kind of unit each kind may sit under (null = the top)
const PARENT_KINDS = { division: [null], domain: ["division"], team: ["division", "domain"] };

module.exports = { ROLES, LEADERSHIP, OVERSEER_ROLES, KINDS, PARENT_KINDS };

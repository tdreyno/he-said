import { relation, term, type Environment } from ".."
import { grant, roleTiers, scopedPolicy, through } from "./index"

type User = { id: string }
type Team = { id: string }
type Workspace = { id: string }
type Document = { id: string }

const actor = term<User>()
const team = term<Team>()

const memberOfTeam = relation<User, Team>()
const teamInWorkspace = relation<Team, Workspace>()
const memberOfWorkspace = relation<User, Workspace>()
const documentInTeam = relation<Document, Team>()

const policy = scopedPolicy({
  actor,
  scope: team,
  membership: {
    relation: memberOfTeam,
    roleColumn: "role",
    tiers: roleTiers("viewer", "editor", "owner"),
  },
  readScope: {
    via: through(teamInWorkspace),
    membership: memberOfWorkspace,
  },
  resources: {
    Document: through(documentInTeam),
  },
  grants: {
    read: grant.readScope(),
    write: grant.atLeast("editor"),
    manage: grant.deny(),
  },
})

policy.ruleFor("write", "Document")
policy.ruleFor("manage", "Document")
policy.roleRequirementFor("write", "Document")

policy.sourceFor("write", "Document", {
  predicates: [],
  orderings: [],
})

void policy.can(
  { id: "u1" },
  "read",
  "Document",
  { id: "d1" },
  {
    environment: {} as Environment,
  },
)

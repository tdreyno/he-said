# ReBAC Guide

Use `@tdreyno/he-said/rebac` when your authorization model is:

- roles held **on** scopes (team/project/workspace),
- resources resolved to an owning scope through relation chains,
- and action thresholds expressed as role tiers (viewer/editor/admin/owner).

## Getting Started

```ts
import { grant, roleTiers, scopedPolicy, through } from "@tdreyno/he-said/rebac"
import { relation, term } from "@tdreyno/he-said"

type User = { id: string }
type Team = { id: string }
type Workspace = { id: string }
type File = { id: string }

const actor = term<User>()
const team = term<Team>()

const memberOfTeam = relation<User, Team>()
const teamInWorkspace = relation<Team, Workspace>()
const memberOfWorkspace = relation<User, Workspace>()
const fileInTeam = relation<File, Team>()

const policy = scopedPolicy({
  actor,
  scope: team,
  membership: {
    relation: memberOfTeam,
    roleColumn: "role",
    tiers: roleTiers("viewer", "editor", "admin", "owner"),
  },
  readScope: {
    via: through(teamInWorkspace),
    membership: memberOfWorkspace,
  },
  resources: {
    File: through(fileInTeam),
  },
  grants: {
    read: grant.readScope(), // workspace member
    update: grant.atLeast("editor"), // team editor+
  },
})
```

## Ownership Helpers

- `through(relA, relB, ...)`: compose an ownership chain.
- `either(pathA, pathB)`: support disjoint parent models.

## Tiered Membership Source Predicates

`grant.atLeast("editor")` compiles tier predicates directly into the membership
rule, so `policy.ruleFor(...)` / `policy.can(...)` enforce the threshold
without extra wiring.

`policy.sourceFor(action, resourceType, source)` remains available when you want
to mirror those predicates onto adapter relation sources.

This keeps rules declarative while preserving adapter-level pushdown for both:

- in-memory relation rows (`predicates` + `orderings`)
- postgres relation mappings (`predicates` + `orderings`)

## Escape Hatch

Any grant can be an arbitrary core rule:

```ts
grants: {
  read: ({ resource, actor }) => authoredBy(resource, actor),
}
```

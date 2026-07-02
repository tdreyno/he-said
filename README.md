# @tdreyno/he-said

Type-safe authorization rule algebra for TypeScript.

he-said lets you model authorization as composable, typed rules instead of scattered conditionals.

Use it to express RBAC, ABAC, ACL, and graph-style access checks with one consistent API.

## SonarQube (SonarCloud)

This repository is configured for SonarCloud project `tdreyno_abac`.

1. Generate coverage (`coverage/lcov.info`) with the Sonar-safe test set (excludes Postgres integration test):

```bash
npm run test:ci:sonar
```

2. Set `SONAR_TOKEN` in your environment (or in `.env`).
3. Run analysis:

```bash
npm run sonar
```

4. Check quality gate status:

```bash
npm run sonar:quality-gate
```

For local MCP-driven Sonar checks in VS Code, use the SonarQube MCP tools against project key `tdreyno_abac`.

## Why he-said

- Type-safe terms and relations with strong TypeScript inference
- Composable logic operators for readable, testable policies
- In-memory evaluation for local development and unit tests
- Postgres planning and execution support for production data
- Proof-oriented evaluation APIs for debugging policy behavior

## Install

```bash
npm install @tdreyno/he-said
```

## Agent Skills (skills.sh)

This repo ships first-party skills to help consumer agents use he-said correctly:

- `he-said-guide`

Install from this repository with skills.sh:

```bash
npx skills add tdreyno/abac
```

Then use `npx skills list` to confirm they were installed for your agent environment.

## Quick Start

```ts
import {
  and,
  createInMemoryAdapter,
  evaluator,
  relation,
  term,
} from "@tdreyno/he-said"

type User = { id: string; suspended: boolean }
type Document = { id: string }

const actor = term<User>()
const document = term<Document>()

const userOwnsDocument = relation<User, Document>()
const activeActor = actor.is(value => !value.suspended)

const canReadDocument = and(userOwnsDocument(activeActor, document))

const u1 = { id: "u1", suspended: false }
const u2 = { id: "u2", suspended: true }
const d1 = { id: "d1" }

const instance = evaluator(
  createInMemoryAdapter({
    relations: [
      {
        relation: userOwnsDocument,
        pairs: [
          [u1, d1],
          [u2, d1],
        ],
      },
    ],
    domain: [u1, u2, d1],
  }),
  { evaluatorContext: null },
)

const allowed = await instance.evaluate(canReadDocument, {
  [actor]: u1,
  [document]: d1,
})

const blocked = await instance.evaluate(canReadDocument, {
  [actor]: u2,
  [document]: d1,
})
```

## What You Can Model

- RBAC: role and scope checks
- ABAC: attribute and context predicates
- ACL: explicit grant relations
- ReBAC-style checks: graph and relationship constraints

## Core API

Core constructors:

- `term<T>()`
- `term<T>().is(jsPredicateOrExpression)`
- `attr(term, "column")`
- `relation<Left, Right>()`
- `exists(term)`
- `eq(leftTerm, rightTermOrValue)`
- `eq(attr(...), attr(...) | value)`
- `ne`, `gt`, `ge`, `lt`, `le`, `isNull`, `isNotNull`

Composition operators:

- `and(...constraints)`
- `or(...constraints)`
- `not(constraint)`
- `implies(premise, consequence)`
- `oneOf(term, values)`
- `atLeast(count, ...constraints)`
- `atMost(count, ...constraints)`
- `exactly(count, ...constraints)`
- `through(term).to(relation, term)`
- `forAll(term, constraint)`
- `select(...terms)(constraint)`
- `distinct(constraint)`
- `letRule(name, constraint)`
- `ref(name)`

Evaluator:

- `evaluator(adapter, { evaluatorContext })`
- `instance.evaluate(rule, environment)`
- `instance.evaluateWithProof(rule, environment)`
  - deny proofs include `proof.failing` with deterministic `path`, `kind`, and `reason`
- `instance.filter(rule, { environment, term, candidates? })`
- `instance.prepare({ environment?, preload?, facts? })`

Prepared evaluators let you bind request-scoped actor facts once and evaluate many rules/resources without rebuilding that actor context on every call.

## Common Building Blocks

- Deny rule: `not(...)`
- Action families: `oneOf(action, ["read", "download"])`
- Cardinality constraints: `atLeast`, `atMost`, `exactly`
- Reusable subrules: `letRule(name, rule)` and `ref(name)`
- Quantified constraints: `forAll(term, constraint)`
- Fluent relation chains: `through(term).to(relation, term)`

For fail-closed admin bypass rules that must still deny missing target rows, use
`exists(term)`:

```ts
const canAdminRead = and(factIsTrue(isAppAdmin), exists(document))
```

## Adapters

### In-Memory Adapter

Use for local evaluation, unit tests, and rule debugging.

- `createInMemoryAdapter({ relations, domain? })`
- `validateStratifiedNegation(rule)`

### Postgres Adapter

Use when relation facts are persisted in SQL tables.

- `createPostgresAdapter({ relationMappings, queryExecutor, ... })`
- `createPostgresAdapter({ relationMappings, queryExecutor, getEvaluatorContext?, ... })`
- `planPostgresRule(rule, { relationMappings, environment, ... })`
  - `createPostgresAdapter` supports `includeFailingNodeSql` (default `false`) to include parameterized failing-node SQL in `proof.failing`
- `planPostgresPredicate(rule, { relationMappings, environment, bindings?, ... })`

`relationMappings[].source` supports both legacy `staticFilters` and typed predicates:

```typescript
{
  kind: "join-table",
  table: "team_members",
  leftColumn: "user_id",
  rightColumn: "team_id",
  predicates: [{ column: "role", op: "ge", value: "editor" }],
  orderings: [
    { column: "role", order: { viewer: 10, editor: 20, admin: 30, owner: 40 } },
  ],
}
```

Typed predicates are compiled to parameterized SQL (`eq`, `in`, `gt`, `ge`, `lt`, `le`).

`planPostgresRule` can produce diagnostics for join-table index hints, domain coverage for `forAll`, and other planner guidance.
`planPostgresPredicate` returns a parameterized `EXISTS(...)` fragment for composing authorization constraints into caller-owned `WHERE` clauses.

For SQL pushdown with `term.is(...)` expressions, configure `termDomains` with `columns` mappings so `attr(term, "column")` can resolve to mapped SQL columns.

## RBAC Package

For role-based access control, use the dedicated RBAC package:

```typescript
import { enforcer, resource, role, policy } from "@tdreyno/he-said/rbac"

// Define resources
const document = resource<"document">()

// Define roles with permissions
const viewer = role().permission("read", document)
const editor = role().permission("read", document).permission("write", document)
const admin = role()
  .permission("read", document)
  .permission("write", document)
  .permission("delete", document)

// Create enforcer
const rbac = enforcer(policy([viewer, editor, admin], []))

// Assign roles
await rbac.roles(editor.id).grant("alice")

// Check permissions
const can = await rbac.enforce("alice", document, "write")
console.log(can.allowed) // true

// Query and manage
const alicePerms = await rbac.users("alice").permissions()
await rbac.roles(editor.id).addPermission("archive", document)
```

The RBAC package provides a fluent, method-based API perfect for role-based patterns. See the [RBAC Guide](docs/rbac-guide.md) and [API Reference](docs/rbac-api.md) for complete documentation.

## ACL Package

For explicit allow/deny style access control, use `@tdreyno/he-said/acl`:

```typescript
import {
  action,
  actionIs,
  allow,
  deny,
  enforcer,
  eq,
  failure,
  policy,
} from "@tdreyno/he-said/acl"

type User = { id: string; suspended: boolean }
type Document = { id: string; ownerId: string }

const READ = action("read")

const denySuspended = deny(
  eq((subject: User) => subject.suspended, true),
  {
    failure: failure("Suspended users cannot access documents."),
    priority: 100,
  },
)

const allowOwnerRead = allow([
  actionIs(READ),
  eq(
    (subject: User) => subject.id,
    (resource: Document) => resource.ownerId,
  ),
])

const acl = enforcer(policy(denySuspended, allowOwnerRead))

const can = await acl.can(READ, {
  subject: user,
  resource: document,
})

console.log(can.allowed)
```

The ACL package provides ACL-native allow/deny semantics with deterministic deny-first precedence and composable algebra-backed rules. See the [ACL Guide](docs/acl-guide.md) and [ACL API Reference](docs/acl-api.md) for full details.

## ABAC Package

For attribute-based access control, use `@tdreyno/he-said/abac`:

```typescript
import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  eqEnv,
  failure,
  ge,
  policy,
} from "@tdreyno/he-said/abac"

type User = {
  id: string
  department: string
  clearance: number
  suspended: boolean
}

type Document = {
  ownerId: string
  department: string
  sensitivity: number
}

type Environment = {
  isBusinessHours: boolean
}

const READ = action("read")
const RULE_DENY_SUSPENDED = failure("Suspended users cannot access documents.")

const denySuspended = deny(
  eq((user: User) => user.suspended, true),
  {
    failure: RULE_DENY_SUSPENDED,
  },
)

const approveRead = approve([
  actionIs<User, Document, Environment>(READ),
  eq(
    (user: User) => user.department,
    (resource: Document) => resource.department,
  ),
  ge(
    (user: User) => user.clearance,
    (resource: Document) => resource.sensitivity,
  ),
])

const abac = enforcer(policy(denySuspended, approveRead))

const can = await abac.can(READ, {
  user,
  resource: document,
  environment,
})

console.log(can.allowed)
```

The ABAC package provides a rule-focused API with action identity tokens, deny/approve precedence, reusable failure tokens, and traceable rule references.

## ReBAC Package

For relationship-scoped roles (for example, "editor on team A"), use
`@tdreyno/he-said/rebac`:

```typescript
import { grant, roleTiers, scopedPolicy, through } from "@tdreyno/he-said/rebac"
import { relation, term } from "@tdreyno/he-said"

type User = { id: string }
type Team = { id: string }
type Document = { id: string }

const actor = term<User>()
const team = term<Team>()

const memberOfTeam = relation<User, Team>()
const documentInTeam = relation<Document, Team>()

const policy = scopedPolicy({
  actor,
  scope: team,
  membership: {
    relation: memberOfTeam,
    roleColumn: "role",
    tiers: roleTiers("viewer", "editor", "owner"),
  },
  resources: {
    Document: through(documentInTeam),
  },
  grants: {
    read: grant.atLeast("viewer"),
    update: grant.atLeast("editor"),
    manage: grant.deny(), // bypass-only action
  },
})
```

Use `/rebac` when roles are held on objects (teams, projects, folders) rather
than globally on the actor.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Core Concepts](docs/core-concepts.md)
- [API Documentation](docs/api.md)
- [In-Memory Evaluation](docs/in-memory-evaluation.md)
- [Type Safety and Terms](docs/type-safety-and-terms.md)
- [RBAC Guide](docs/rbac-guide.md)
- [RBAC API Reference](docs/rbac-api.md)
- [ACL Guide](docs/acl-guide.md)
- [ACL API Reference](docs/acl-api.md)
- [ABAC Guide](docs/abac-guide.md)
- [ABAC API Reference](docs/abac-api.md)
- [ABAC on Postgres](docs/abac-postgres-guide.md)
- [ReBAC Guide](docs/rebac-guide.md)
- [CASL Comparison](docs/casl-comparison.md)
- [CASL Migration Guide](docs/casl-migration-guide.md)
- [RBAC Example](docs/rbac-implementation.md)
- [ACL Example](docs/acl-implementation.md)
- [ABAC Example](docs/abac-implementation.md)
- [FAQ](docs/faq.md)

## When To Use

Use he-said when you want policy logic to be explicit, typed, and reusable across services, route handlers, and tests.

If your authorization model is small today but expected to grow, starting with composable rules helps avoid hard-to-maintain permission conditionals later.

## Development

```bash
npm run lint
npm run typecheck
npm run build
npm run test:ci
npm run test:types
```

## License

MIT

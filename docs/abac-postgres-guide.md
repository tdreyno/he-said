# ABAC on Postgres

This guide shows the same ABAC policy in two modes:

1. In-memory evaluation.
2. Postgres-backed evaluation with SQL-compilable rules.

## Policy shape

```ts
import {
  attr,
  createInMemoryAdapter,
  createPostgresAdapter,
  eq,
  ge,
  relation,
} from "@tdreyno/he-said"
import {
  action,
  approve,
  deny,
  enforcer,
  failure,
  policy,
  resourceTerm,
  userTerm,
} from "@tdreyno/he-said/abac"

type User = {
  id: string
  department: string
  clearance: number
  suspended: boolean
}

type Document = {
  id: string
  department: string
  sensitivity: number
}

const READ = action("read")
const SUSPENDED = failure("Suspended users cannot access documents.")

const userCanAccessDocument = relation<User, Document>()

const denySuspended = deny(eq(attr(userTerm<User>(), "suspended"), true), {
  failure: SUSPENDED,
  name: "deny-suspended",
})

const approveRead = approve([
  userCanAccessDocument(userTerm<User>(), resourceTerm<Document>()),
  eq(
    attr(userTerm<User>(), "department"),
    attr(resourceTerm<Document>(), "department"),
  ),
  ge(
    attr(userTerm<User>(), "clearance"),
    attr(resourceTerm<Document>(), "sensitivity"),
  ),
])

const accessPolicy = policy(denySuspended, approveRead)
```

## In-memory mode

```ts
const u1: User = { id: "u1", department: "eng", clearance: 5, suspended: false }
const d1: Document = { id: "d1", department: "eng", sensitivity: 3 }

const memoryAuthz = enforcer(accessPolicy, {
  adapter: createInMemoryAdapter({
    relations: [{ relation: userCanAccessDocument, pairs: [[u1, d1]] }],
    domain: [u1, d1],
  }),
})

const memoryDecision = await memoryAuthz.can(READ, {
  user: u1,
  resource: d1,
  environment: {},
})
```

## Postgres mode

```ts
const sqlAuthz = enforcer(accessPolicy, {
  adapter: createPostgresAdapter({
    relationMappings: [
      {
        relation: userCanAccessDocument,
        source: {
          table: "workspace_memberships",
          leftColumn: "user_id",
          rightColumn: "document_id",
        },
      },
    ],
    termDomains: [
      {
        term: userTerm<User>(),
        table: "users",
        valueColumn: "id",
        columns: {
          suspended: "suspended",
          department: "department",
          clearance: "clearance",
        },
      },
      {
        term: resourceTerm<Document>(),
        table: "documents",
        valueColumn: "id",
        columns: {
          department: "department",
          sensitivity: "sensitivity",
        },
      },
    ],
    termEncodings: [
      { term: userTerm<User>(), encode: user => user.id },
      { term: resourceTerm<Document>(), encode: document => document.id },
    ],
    queryExecutor: pgClient,
    includeFailingNodeSql: true,
  }),
  evaluatorContext: null,
})

const sqlDecision = await sqlAuthz.can(READ, {
  user: { id: "u1", department: "eng", clearance: 5, suspended: false },
  resource: { id: "d1", department: "eng", sensitivity: 3 },
  environment: {},
})
```

## Notes

- Deny rules run before approve rules.
- `failure(...)` tokens still drive deny reasons.
- `can(...).trace.checkedRules[*].proof` includes adapter proof details and failing-node diagnostics for non-matching checks.
- Closure predicates remain valid for in-memory ABAC; Postgres requires SQL-compilable rule expressions.

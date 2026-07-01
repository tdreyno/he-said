# CASL to he-said: Concept Comparison

This guide maps common CASL Ability concepts to `@tdreyno/he-said` core APIs and package-level APIs.

he-said does **not** mirror CASL one-to-one. Instead, it gives you typed rule algebra (core) plus opinionated packages for ACL/ABAC authoring.

## Concept Mapping

| CASL concept            | Typical CASL shape                        | he-said equivalent                                                                                  | Notes                                                                      |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ability definition      | `new AbilityBuilder(...)` + `can/cannot`  | Core rule expression + `evaluator(...)`, or `policy(...)` with `enforcer(...)` in ACL/ABAC packages | he-said separates rule construction from evaluation.                       |
| `can(...)` allow rule   | Action/subject/conditions entry           | `allow(...)` (ACL) or `approve(...)` (ABAC), or plain rule composition in core                      | Package APIs are closest to CASL-style policy authoring.                   |
| `cannot(...)` deny rule | Negative rule with precedence             | `deny(...)` in ACL/ABAC                                                                             | Deny precedence is explicit and deterministic in package policies.         |
| Subject type checks     | Subject-based matching                    | Typed `term<T>()`, `subject(...)`, `resource(...)`, relation modeling                               | Type safety is compile-time, not runtime class metadata.                   |
| Conditions object       | Mongo-style condition DSL                 | Selector comparators (`eq`, `ge`, etc.) + logical composition (`and`, `or`, `not`)                  | Prefer explicit predicates/selectors over condition-object mini-languages. |
| Action names            | String action labels                      | Action tokens from `action("read")` (ACL/ABAC) or your own typed terms in core                      | Package actions are symbol tokens (reference identity).                    |
| Explainability          | Rule hit diagnostics (depending on usage) | Decision trace and optional failure tokens/reasons                                                  | ACL/ABAC include rule refs, optional names, and failure metadata.          |

## Side-by-Side Pattern 1: Basic owner check

CASL-style intent:

```ts
// CASL-style pseudocode
// can("read", "Document", { ownerId: user.id })
```

he-said core:

```ts
import {
  and,
  eq,
  evaluator,
  createInMemoryAdapter,
  term,
} from "@tdreyno/he-said"

type User = { id: string }
type Document = { ownerId: string }

const user = term<User>()
const document = term<Document>()

const canReadOwnDocument = and(
  eq(
    (u: User) => u.id,
    (d: Document) => d.ownerId,
  ),
)

const engine = evaluator(createInMemoryAdapter({ relations: [] }), {
  evaluatorContext: undefined,
})

const allowed = await engine.evaluate(canReadOwnDocument, {
  [user]: { id: "u1" },
  [document]: { ownerId: "u1" },
})
```

## Side-by-Side Pattern 2: Allow + deny precedence

CASL-style intent:

```ts
// CASL-style pseudocode
// can("read", "Document", { ownerId: user.id })
// cannot("read", "Document", { archived: true })
```

he-said ACL package:

```ts
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

type Subject = { id: string }
type Resource = { ownerId: string; archived: boolean }

const READ = action("read")

const denyArchived = deny(
  eq((resource: Resource) => resource.archived, true),
  { failure: failure("Archived documents are read-only.") },
)

const allowOwnerRead = allow([
  actionIs(READ),
  eq(
    (subject: Subject) => subject.id,
    (resource: Resource) => resource.ownerId,
  ),
])

const acl = enforcer(policy(denyArchived, allowOwnerRead))

const decision = await acl.can(READ, {
  subject: { id: "u1" },
  resource: { ownerId: "u1", archived: false },
})
```

## Side-by-Side Pattern 3: Attribute-driven checks

CASL-style intent:

```ts
// CASL-style pseudocode
// can("read", "Document", {
//   department: user.department,
//   sensitivity: { $lte: user.clearance },
// })
```

he-said ABAC package:

```ts
import {
  all,
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  failure,
  ge,
  policy,
} from "@tdreyno/he-said/abac"

type User = { department: string; clearance: number; suspended: boolean }
type Document = { department: string; sensitivity: number }

const READ = action("read")

const denySuspended = deny(
  eq((user: User) => user.suspended, true),
  { failure: failure("Suspended users cannot access documents.") },
)

const approveRead = approve(
  all(
    actionIs(READ),
    eq(
      (user: User) => user.department,
      (resource: Document) => resource.department,
    ),
    ge(
      (user: User) => user.clearance,
      (resource: Document) => resource.sensitivity,
    ),
  ),
)

const authz = enforcer(policy(denySuspended, approveRead))
```

## Choosing Core vs ACL vs ABAC

| Choose this                    | When it fits                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Core (`@tdreyno/he-said`)      | You need fully custom rule shapes, relation-heavy checks, or reusable algebra primitives across multiple policy styles. |
| ACL (`@tdreyno/he-said/acl`)   | You want explicit allow/deny semantics and direct subject/resource/action vocabulary.                                   |
| ABAC (`@tdreyno/he-said/abac`) | You want attribute-focused policies with approve/deny rules and environment-aware checks.                               |

## Practical Takeaway

For teams coming from CASL Ability:

1. Start with ACL/ABAC for familiar policy authoring ergonomics.
2. Move shared or advanced constraints into core algebra helpers as policies grow.
3. Keep deny reasons/failure tokens to preserve debuggability during migration.

## Optional local DX helpers (app-level)

If you want a CASL-like migration layer without changing library APIs, define tiny helpers in your app:

```ts
import { and } from "@tdreyno/he-said"
import { eq, ge } from "@tdreyno/he-said/abac"
import type { Rule } from "@tdreyno/he-said"

export const all = (...rules: Rule[]): Rule => and(...rules)

export const same = <L, R, T>(left: (left: L) => T, right: (right: R) => T) =>
  eq(left, right)

export const lteBy = <User, Resource>(
  resourceSelector: (resource: Resource) => number,
  userSelector: (user: User) => number,
) => ge(userSelector, resourceSelector)
```

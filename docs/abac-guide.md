# ABAC Guide

This guide covers the ABAC package in `@tdreyno/he-said/abac`.

ABAC here means:

- You define `approve(...)` and `deny(...)` rules.
- Rules are built from core algebra constraints.
- You evaluate with `can(actionToken, { user, resource, environment })`.

## Getting Started

```ts
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
const RULE_DENY_AFTER_HOURS = failure("Access blocked outside allowed hours.")

const denySuspended = deny(
  eq((user: User) => user.suspended, true),
  {
    failure: RULE_DENY_SUSPENDED,
  },
)

const denyAfterHours = deny(
  [actionIs(READ), eqEnv(environment => environment.isBusinessHours, false)],
  { failure: RULE_DENY_AFTER_HOURS, name: "after-hours" },
)

const approveRead = approve([
  actionIs(READ),
  eq(
    (user: User) => user.department,
    (resource: Document) => resource.department,
  ),
  ge(
    (user: User) => user.clearance,
    (resource: Document) => resource.sensitivity,
  ),
])

const authz = enforcer(policy(denySuspended, denyAfterHours, approveRead))

const decision = await authz.can(READ, {
  user: {
    id: "u1",
    department: "engineering",
    clearance: 4,
    suspended: false,
  },
  resource: {
    ownerId: "u2",
    department: "engineering",
    sensitivity: 2,
  },
  environment: {
    isBusinessHours: true,
  },
})

console.log(decision.allowed)
```

## Core Concepts

### Actions Are Identity Tokens

Actions are symbols, compared by reference:

```ts
const READ = action("read")
const UPDATE = action("update")
```

`action("read")` called twice creates two different tokens.

### Rules

- `approve(ruleOrRules, options?)`
- `deny(ruleOrRules, options?)`

`Rule[]` is normalized to `and(...rules)`.

### Failures

Create reusable failure tokens:

```ts
const RULE_DENY_SUSPENDED = failure("Suspended users cannot access documents.")
```

Attach to deny (or approve) rules:

```ts
const denySuspended = deny(
  eq((user: User) => user.suspended, true),
  {
    failure: RULE_DENY_SUSPENDED,
  },
)
```

### Policy and Evaluation

Policies are variadic:

```ts
const p = policy(ruleA, ruleB, ruleC)
```

Evaluate with `can`:

```ts
const decision = await authz.can(READ, { user, resource, environment })
```

## Authoring Patterns

### 1. Direct Rule

```ts
const denySuspended = deny(eq((user: User) => user.suspended, true))
```

### 2. Rule Array (AND shorthand)

```ts
const approveRead = approve([
  actionIs(READ),
  eq(
    (user: User) => user.department,
    (resource: Document) => resource.department,
  ),
])
```

### 3. Priority and Name Metadata

```ts
const denyAfterHours = deny(rule, {
  name: "after-hours",
  priority: 100,
  failure: RULE_DENY_AFTER_HOURS,
})
```

Higher priority evaluates first. Same priority ties are resolved with deny first.

### 4. Core-Algebra Fluent Composition

You can keep ABAC ergonomics and still compose rules with core algebra operators.

```ts
import { and, atLeast, not, or } from "@tdreyno/he-said"
import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  eqEnv,
  ge,
  policy,
} from "@tdreyno/he-said/abac"

const READ = action("read")

const sameDepartment = eq(
  (user: User) => user.department,
  (resource: Document) => resource.department,
)

const isOwner = eq(
  (user: User) => user.id,
  (resource: Document) => resource.ownerId,
)

const sufficientClearance = ge(
  (user: User) => user.clearance,
  (resource: Document) => resource.sensitivity,
)

const duringBusinessHours = eqEnv(
  (environment: Environment) => environment.isBusinessHours,
  true,
)

const approveRead = approve(
  and(
    actionIs(READ),
    not(eq((resource: Document) => resource.archived, true)),
    duringBusinessHours,
    or(
      isOwner,
      and(sameDepartment, sufficientClearance),
      atLeast(2, sameDepartment, isOwner, sufficientClearance),
    ),
  ),
)

const authz = enforcer(policy(denySuspended, approveRead))
```

Full runnable example:

- `src/abac/examples/example-core-algebra-fluent.ts`

## Decision and Trace

A decision includes:

- `allowed`
- optional `failureToken`
- optional `reason`
- `trace` with checked and matched rule entries

Trace entries include stable rule reference tokens and optional names.

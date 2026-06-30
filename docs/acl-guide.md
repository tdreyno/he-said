# ACL Guide

This guide covers the ACL package in `@tdreyno/he-said/acl`.

ACL here means:

- You define explicit `allow(...)` and `deny(...)` rules.
- Rules compile to core algebra constraints.
- Decisions use `can(actionToken, { subject, resource, environment? })`.
- Deny precedence is deterministic: deny first, then allow, then default deny.

## Getting Started

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

type User = {
  id: string
  suspended: boolean
}

type Document = {
  id: string
  ownerId: string
}

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

const decision = await acl.can(READ, {
  subject: {
    id: "u1",
    suspended: false,
  },
  resource: {
    id: "d1",
    ownerId: "u1",
  },
})

console.log(decision.allowed)
```

## Core Concepts

### Identity Tokens

Create identity tokens with optional labels:

```ts
const READ = action("read")
```

Action tokens are symbols and compare by reference.

### Rule Builders

- `allow(ruleOrRules, options?)`
- `deny(ruleOrRules, options?)`

`ruleOrRules` accepts:

- `Rule`
- `Rule[]` (normalized to `and(...rules)`)

### Generic Comparator Mapping

ACL v1 keeps one comparator primitive:

- `eq(leftSelector, value)`
- `eq(leftSelector, rightSelector)`

This avoids alias helpers and keeps ACL surface minimal.

### Policy and Evaluation

Compose rules with:

```ts
const aclPolicy = policy(ruleA, ruleB, ruleC)
```

Evaluate with:

```ts
const decision = await acl.can(READ, {
  subject,
  resource,
  environment,
})
```

`environment` is optional.

## Authoring Patterns

### 1. Direct Deny Rule

```ts
const denySuspended = deny(eq((subject: User) => subject.suspended, true))
```

### 2. Rule Array (AND shorthand)

```ts
const allowOwnerRead = allow([
  actionIs(READ),
  eq(
    (subject: User) => subject.id,
    (resource: Document) => resource.ownerId,
  ),
])
```

### 3. Priority and Failure Metadata

```ts
const denyAfterHours = deny(rule, {
  name: "after-hours",
  priority: 100,
  failure: failure("Access blocked outside allowed hours."),
})
```

## Decision and Trace

A decision includes:

- `allowed`
- optional `failureToken`
- optional `reason`
- `trace` with checked and matched rule entries

## Examples

- `src/acl/examples/example-basic.ts`
- `src/acl/examples/example-inheritance.ts`
- `src/acl/examples/example-multitenancy.ts`

## When To Use ACL vs Core

Use `@tdreyno/he-said/acl` when you want explicit allow/deny semantics with ACL vocabulary.
Use core algebra directly when you need full custom rule shapes and relation modeling.

For conceptual relation-backed ACL modeling, see [Implementing ACL](./acl-implementation.md).

# Implementing ABAC

This guide shows a simple, real-world ABAC model in Rules.

Scenario:

- A support team works with customer records.
- Access depends on user and resource attributes.
- Analysts can read records only for their assigned region.
- Suspended users cannot access records.
- High-risk records can be read only by users with a risk clearance.

The example keeps ABAC centered on attributes and predicates, not role tables or ACL entries.

## Domain Model

### Types

```ts
type User = {
  id: string
  suspended: boolean
  region: string
  hasRiskClearance: boolean
}

type CustomerRecord = {
  id: string
  region: string
  riskLevel: "normal" | "high"
}
```

### Terms and Predicates

```ts
import { and, atMost, eq, not, oneOf, or, term } from "@tdreyno/rules"

const actor = term<User>()
const record = term<CustomerRecord>()

const activeUser = actor.is(user => !user.suspended)

const sameRegionRecord = record.is((value, env: { actorRegion: string }) => {
  return value.region === env.actorRegion
})

const highRiskRecord = record.is(value => value.riskLevel === "high")
const lowRiskRecord = record.is(value => value.riskLevel === "normal")

const actorHasRiskClearance = actor.is(user => user.hasRiskClearance)
```

## ABAC Rules

This section maps business attribute rules directly into policy rules.

```ts
const canReadNormalRiskRecord = and(activeUser, sameRegionRecord, lowRiskRecord)

const canReadHighRiskRecord = and(
  activeUser,
  sameRegionRecord,
  highRiskRecord,
  actorHasRiskClearance,
)

const canReadRecord = or(canReadNormalRiskRecord, canReadHighRiskRecord)
```

If your request includes explicit action values, group read-like actions with oneOf:

```ts
type Action = "read" | "download" | "write"

const action = term<Action>()

const canAccessRecord = and(oneOf(action, ["read", "download"]), canReadRecord)
```

If your policy has explicit deny attributes, keep deny logic clear and local:

```ts
const deniedBySuspension = actor.is(user => user.suspended)

const canReadRecordWithExplicitDeny = and(
  not(deniedBySuspension),
  canReadRecord,
)
```

When multiple boolean checks are optional but bounded, cardinality helpers keep intent explicit:

```ts
const hasBreakGlass = term<boolean>()
const hasManagerApproval = term<boolean>()
const hasRiskOverride = term<boolean>()

const canUseOverride = and(
  atMost(
    1,
    eq(hasBreakGlass, true),
    eq(hasManagerApproval, true),
    eq(hasRiskOverride, true),
  ),
  canReadRecord,
)
```

## Suggested Migration Path

1. Pick one endpoint with attribute-heavy conditions.
2. Extract each condition into a named derived term using term.is(...).
3. Compose one endpoint rule with and/or/not.
4. Move request context values into environment fields used by predicates.
5. Repeat for adjacent endpoints and share predicates where useful.

## Common Pitfalls

- Mixing role checks into ABAC predicates instead of composing a separate RBAC rule.
- Reading current time directly in predicates instead of passing a deterministic value through environment.
- Writing large inline predicates instead of naming smaller, reusable ones.
- Forgetting that term predicates can use both bound term values and environment values.

## Practical Rule of Thumb

Keep ABAC readable by naming attribute checks first:

- Derived terms describe attribute truth.
- Composed rules describe business decisions.
- Environment values provide request-time context.

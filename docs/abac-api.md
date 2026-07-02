# ABAC API Reference

## Imports

```ts
import {
  action,
  actionIs,
  actionIn,
  approve,
  deny,
  policy,
  enforcer,
  failure,
  failureMessage,
  all,
  userTerm,
  resourceTerm,
  environmentTerm,
  eq,
  ge,
  eqEnv,
} from "@tdreyno/he-said/abac"
```

## Action Tokens

### `action(label?)`

Create an action identity token.

```ts
const READ = action("read")
const UPDATE = action("update")
```

### `actionIs(...)`

Match by action token reference.

```ts
actionIs(READ)
```

### `actionIn(...tokens)`

Match any of the provided action tokens.

```ts
actionIn(READ, UPDATE)
```

## Rule Builders

### `approve(ruleOrRules, options?)`

Create an approve rule.

### `deny(ruleOrRules, options?)`

Create a deny rule.

`ruleOrRules` accepts:

- `Rule`
- `Rule[]` (normalized to `and(...rules)`)

`options`:

- `name?: string`
- `failure?: FailureToken`
- `priority?: number`

## Policy

### `policy(...rules)`

Create a policy from variadic rules.

```ts
const p = policy(ruleA, ruleB, ruleC)
```

## Enforcer

### `enforcer(policy, options?)`

Create an immutable enforcer instance.

`options`:

- `adapter?: EvaluatorAdapter<Record<PropertyKey, unknown>, Context>`
- `evaluatorContext?: Context`

### `authz.can(actionToken, context)`

Evaluate a single decision.

```ts
const result = await authz.can(READ, {
  user,
  resource,
  environment,
})
```

### `authz.policy()`

Return the policy used by the enforcer.

## Failure Tokens

### `failure(message?)`

Create a reusable failure token.

```ts
const RULE_DENY_SUSPENDED = failure("Suspended users cannot access documents.")
```

### `failureMessage(token)`

Read optional message metadata from a failure token.

## Comparators and Combinators

### `eq(...)`

```ts
eq(
  (user: User) => user.department,
  (resource: Resource) => resource.department,
)
eq((user: User) => user.suspended, true)

// expression-based (SQL-compilable with postgres adapter)
eq(
  attr(userTerm<User>(), "department"),
  attr(resourceTerm<Resource>(), "department"),
)
```

### `ge(...)`

```ts
ge(
  (user: User) => user.clearance,
  (resource: Resource) => resource.sensitivity,
)

// expression-based
ge(
  attr(userTerm<User>(), "clearance"),
  attr(resourceTerm<Resource>(), "sensitivity"),
)
```

### `eqEnv(...)`

```ts
eqEnv(env => env.isBusinessHours, false)
```

### `all(...rules)`

Alias for logical `and` composition.

## Types

Main exported types:

- `ActionToken`
- `FailureToken`
- `RuleRef`
- `PolicyRef`
- `CanContext`
- `CanDecision`
- `DecisionTrace`
- `RuleTrace`
- `ABACEnforcer`

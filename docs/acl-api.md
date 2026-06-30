# ACL API Reference

## Imports

```ts
import {
  action,
  actionIn,
  actionIs,
  actionLabel,
  allow,
  deny,
  enforcer,
  entry,
  eq,
  failure,
  failureMessage,
  policy,
  resource,
  resourceLabel,
  subject,
  subjectLabel,
} from "@tdreyno/he-said/acl"
```

## Token Constructors

### `action(label?)`

Create an action identity token.

### `subject(label?)`

Create a subject identity token.

### `resource(label?)`

Create a resource identity token.

### Label accessors

- `actionLabel(token)`
- `subjectLabel(token)`
- `resourceLabel(token)`

These return optional label metadata.

## Rule Builders

### `allow(ruleOrRules, options?)`

Create an allow rule.

### `deny(ruleOrRules, options?)`

Create a deny rule.

`ruleOrRules` accepts:

- `Rule`
- `Rule[]` (normalized to `and(...rules)`)

`options`:

- `name?: string`
- `failure?: FailureToken`
- `priority?: number`

### `entry(subjectToken, resourceToken, actionToken)`

Build a rule from explicit ACL identity tokens.

## Match Helpers

### `actionIs(token)`

Match a single action token.

### `actionIn(...tokens)`

Match any of the provided action tokens.

### `eq(leftSelector, value)`

### `eq(leftSelector, rightSelector)`

Generic selector mapping comparator for ACL subject/resource comparisons.

## Policy

### `policy(...rules)`

Create an ACL policy from variadic rules.

## Enforcer

### `enforcer(policy)`

Create an immutable ACL enforcer.

### `acl.can(actionToken, context)`

Evaluate a single decision.

```ts
const result = await acl.can(READ, {
  subject,
  resource,
  environment,
})
```

### `acl.policy()`

Return the policy used by the enforcer.

## Failure Tokens

### `failure(message?)`

Create a reusable failure token.

### `failureMessage(token)`

Read optional message metadata from a failure token.

## Types

Main exported types:

- `ActionToken`
- `SubjectToken`
- `ResourceToken`
- `FailureToken`
- `RuleRef`
- `PolicyRef`
- `CanContext`
- `CanDecision`
- `DecisionTrace`
- `RuleTrace`
- `ACLEnforcer`

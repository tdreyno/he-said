# Migration Guide: CASL -> he-said

This guide provides a practical, incremental path from CASL Ability DSL to `@tdreyno/he-said`.

The goal is parity first, then cleanup and stronger typing.

## Before You Start

Inventory your current CASL usage:

1. Where abilities are built (single file vs per-feature).
2. All `can`/`cannot` rules by action + subject.
3. Dynamic conditions (ownership, tenant boundaries, clearance, lifecycle state).
4. Any custom field-level logic or action aliases.
5. How denials are surfaced in logs/API responses.

Keep this inventory as your migration checklist baseline.

## Phase 1: Mirror existing authorization behavior

Start by recreating current outcomes with minimal conceptual changes.

Recommended approach:

1. Map each CASL action to a token (`action("read")`) for ACL/ABAC packages.
2. Port each allow rule to `allow(...)` (ACL) or `approve(...)` (ABAC).
3. Port each deny rule to `deny(...)`.
4. Add explicit failure tokens for high-signal deny cases.

Parity objective: for the same input contexts, allowed/denied outcomes remain unchanged.

## Phase 2: Convert condition objects into typed selectors and rules

CASL conditions often use object syntax; he-said prefers typed selectors and composable constraints.

Common translations:

| CASL-style condition intent               | he-said translation                                                |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `ownerId === user.id`                     | `eq((subject) => subject.id, (resource) => resource.ownerId)`      |
| `resource.department === user.department` | `eq((user) => user.department, (resource) => resource.department)` |
| `resource.sensitivity <= user.clearance`  | `ge((user) => user.clearance, (resource) => resource.sensitivity)` |
| Multiple required clauses                 | `and(...)` (or `all(...)` in ABAC / array shorthand in ACL/ABAC)   |
| Alternative clauses                       | `or(...)`                                                          |

Keep selectors small and explicit. Reuse common selectors across rules.

## Phase 3: Extract shared policy logic into reusable units

Once parity is stable, reduce duplication:

1. Promote repeated constraints into reusable helpers.
2. Use core algebra composition for shared guardrails.
3. Keep package APIs (ACL/ABAC) as the main policy entrypoint where they fit.

Example progression:

- Early migration: each route/module has direct translated rule entries.
- Later migration: shared rules (suspension checks, tenant checks, environment gates) become reused building blocks.

## Phase 4: Remove CASL and finalize parity protections

After production-equivalent parity is confirmed:

1. Remove CASL policy definitions and runtime wiring.
2. Keep regression tests that assert expected allow/deny behavior for critical paths.
3. Keep trace/failure metadata in logs for troubleshooting.
4. Update team docs/examples to only use he-said patterns.

## Parity Checklist

Use this checklist before removing CASL:

- [ ] Every CASL action+subject combination has a mapped he-said rule path.
- [ ] Explicit deny paths are preserved (or intentionally changed and documented).
- [ ] Critical policy scenarios are covered with deterministic test cases.
- [ ] API/UX behavior for denied requests still returns expected status/reason semantics.
- [ ] Observability includes enough context to investigate policy outcomes.

## Pitfalls to Avoid

1. Assuming action labels are identity-equivalent across systems without explicit token mapping.
2. Migrating by endpoint only, while leaving shared policy fragments duplicated and drifting.
3. Dropping deny metadata during migration, reducing debug signal.
4. Rewriting policy architecture and business behavior in the same step (separate these concerns).

## Rollback-Safe Migration Pattern

For large systems, migrate behind a feature flag:

1. Evaluate both CASL and he-said in parallel for selected requests.
2. Record mismatches with enough input context to reproduce.
3. Resolve mismatch classes, then progressively switch reads to he-said decisions.
4. Remove dual-run mode once mismatch rate is effectively zero in representative traffic.

## Optional local DX helpers during migration

If your team prefers more CASL-like readability, add small app-level wrappers while migrating:

```ts
import { and, type Rule } from "@tdreyno/he-said"
import { eq, ge } from "@tdreyno/he-said/abac"

export const all = (...rules: Rule[]): Rule => and(...rules)

export const same = <L, R, T>(left: (left: L) => T, right: (right: R) => T) =>
  eq(left, right)

export const lteBy = <User, Resource>(
  resourceSelector: (resource: Resource) => number,
  userSelector: (user: User) => number,
) => ge(userSelector, resourceSelector)
```

Keep these helpers local to your app so migration ergonomics improve without coupling docs to non-exported package APIs.

## Where to go next

- [CASL to he-said: Concept Comparison](./casl-comparison.md)
- [ACL Guide](./acl-guide.md)
- [ABAC Guide](./abac-guide.md)
- [Core Concepts](./core-concepts.md)

# Core Concepts

he-said models authorization as rule algebra over typed terms.

## Terms

Use term() to create symbolic variables that participate in rules.

- Terms are symbols, not runtime strings.
- Type information flows through each term.
- Derived terms created with term.is(...) keep the same root term and add predicate filters.

## Relations

Use relation<Left, Right>() to define graph edges between typed terms.

- A relation returns a rule node when applied: relation(leftTerm, rightTerm).
- Each relation has a unique relation id used by evaluator adapters.

## Rule Composition

he-said supports logical and structural operators:

- and(...constraints)
- or(...constraints)
- not(constraint)
- implies(premise, consequence)
- eq(term, termOrValue)
- oneOf(term, values)
- atLeast(count, ...constraints)
- atMost(count, ...constraints)
- exactly(count, ...constraints)
- forAll(term, constraint)
- select(...terms)(constraint)
- distinct(constraint)
- letRule(name, constraint)
- ref(name)

These operators produce plain rule trees that adapters evaluate.

## Environments

Evaluation receives an environment object with bindings for term symbols and optional string keys.
You can also pass identity-keyed `facts` and keep them separate from the main environment:

```ts
const isAppAdmin = fact<boolean>()
await engine.evaluate(canManage, {
  [actor]: currentUser,
  facts: {
    [isAppAdmin]: true,
  },
})
```

### Facts

Use `fact<T>()` for request-time values that are computed outside relation data (feature flags, external group membership, break-glass toggles).

- Facts are symbol identity tokens, like terms.
- Facts should be passed through `facts: { [factToken]: value }`.
- Optional labels are for debugging only (for example `fact<boolean>("isAppAdmin")`).

```ts
const isAppAdmin = fact<boolean>()
const hasBreakGlass = fact<boolean>()

const canManage = or(
  and(factIsTrue(isAppAdmin), exists(document)),
  and(factIsTrue(hasBreakGlass), canManageDocument),
)

await engine.evaluate(canManage, {
  [actor]: currentUser,
  [document]: currentDocument,
  facts: {
    [isAppAdmin]: false,
    [hasBreakGlass]: true,
  },
})
```

Examples:

- Bind a user term to a concrete user value.
- Pass extra context fields as string keys for predicates.

## Proofs

evaluateWithProof returns an EvaluationProof object.

- ok indicates whether at least one environment matched.
- rule includes the evaluated rule tree.
- failing (when ok is false) identifies the first unsatisfied node using a deterministic AST path.
- details is adapter-specific metadata.

## Core Algebra Enhancements

### derives(entity, from)

The `derives()` primitive models transitive relationships between entities. It's useful for:

- **Role hierarchies**: A manager role derives from a member role (inherits member permissions)
- **Permission delegation**: A delegated permission derives from the original
- **Entity relationships**: One entity derives from another in a transitive chain

Example:

```typescript
import { term, derives } from "@tdreyno/he-said"

const user = term<{ id: string; role: string }>()
const role = term<string>()
const managerRole = term<string>()

// "user has role via derives from manager role"
const rule = and(
  derives(user, managerRole),
  // ... other constraints
)
```

Both in-memory and PostgreSQL adapters support derives automatically:

- **In-memory**: Unifies the two terms via environment matching
- **PostgreSQL**: Compiles to SQL equality constraints

### given(rule, context)

The `given()` primitive scopes a rule to a context. It's useful for:

- **Workspace/domain scoping**: Rule applies given a workspace context
- **Time-window scoping**: Rule applies given a time range
- **Conditional scoping**: Rule applies given a condition is true

Example:

```typescript
import { term, given, relation } from "@tdreyno/he-said"

const user = term<User>()
const workspace = term<Workspace>()
const readPermission = term<Permission>()
const permission = relation<User, Permission>()
const belongsToWorkspace = relation<User, Workspace>()

// "user has permission, given they're in the workspace"
const rule = given(
  permission(user, readPermission),
  belongsToWorkspace(user, workspace),
)
```

Both adapters support given automatically:

- **In-memory**: Evaluates context first, then main rule within that context
- **PostgreSQL**: Compiles context to an EXISTS subquery, ANDed with the main rule

### Pattern-Agnostic

Both `derives()` and `given()` are **pattern-agnostic**. They work equally well for:

- RBAC (role-based access control)
- ABAC (attribute-based access control)
- ReBAC (relationship-based access control)
- Custom authorization patterns

## Higher-Level APIs

While the core algebra is low-level and flexible, he-said provides higher-level APIs for common patterns:

### RBAC Package

For role-based access control, use `@tdreyno/he-said/rbac`:

```typescript
import { enforcer, resource, role, policy } from "@tdreyno/he-said/rbac"

const post = resource<"post">()
const admin = role().permission("delete", post)
const rbac = enforcer(policy([admin], []))

await rbac.roles(admin.id).grant("alice")
const can = await rbac.enforce("alice", post, "delete")
```

The RBAC package compiles down to core algebra rules under the hood. See [RBAC Guide](./rbac-guide.md) for more.

### ABAC Package

For attribute-based access control, use `@tdreyno/he-said/abac`:

```typescript
import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  ge,
  policy,
} from "@tdreyno/he-said/abac"

const READ = action("read")

const denySuspended = deny(eq((user: User) => user.suspended, true))

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

const abac = enforcer(policy(denySuspended, approveRead))
const result = await abac.can(READ, { user, resource: document, environment })
```

The ABAC package compiles to core algebra constraints while keeping policy authoring focused on approve/deny rules, action identity tokens, and reusable failure metadata.

See [ABAC Guide](./abac-guide.md) and [ABAC API](./abac-api.md) for full details.

### ReBAC Package

For relationship-based access control with scope-bound roles, use
`@tdreyno/he-said/rebac`:

```typescript
import { grant, roleTiers, scopedPolicy, through } from "@tdreyno/he-said/rebac"
import { relation, term } from "@tdreyno/he-said"

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
  },
})
```

Use `/rebac` when users hold roles on objects (team/project/workspace) and each
resource must resolve to an owning scope before checking the role threshold.

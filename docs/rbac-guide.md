# RBAC Guide

This guide covers role-based access control (RBAC) in `@tdreyno/he-said`. RBAC is a straightforward authorization pattern where users are assigned roles, and roles have permissions.

## Getting Started

### Installation

```typescript
import { enforcer, resource, role, policy } from "@tdreyno/he-said/rbac"
```

### Basic Example

Define resources:

```typescript
const post = resource<"post">()
const comment = resource<"comment">()
```

Define roles with permissions:

```typescript
const viewer = role().permission("read", post).permission("read", comment)

const editor = role()
  .permission("read", post)
  .permission("write", post)
  .permission("read", comment)
  .permission("write", comment)

const admin = role()
  .permission("read", post)
  .permission("write", post)
  .permission("delete", post)
  .permission("read", comment)
  .permission("write", comment)
  .permission("delete", comment)
```

Create the enforcer:

```typescript
const rbac = enforcer(policy([viewer, editor, admin], []))
```

Assign roles and check permissions:

```typescript
// Grant editor role to alice
await rbac.roles(editor.id).grant("alice")

// Check if alice can write posts
const canWrite = await rbac.enforce("alice", post, "write")
console.log(canWrite.allowed) // true

// Check if alice can delete posts
const canDelete = await rbac.enforce("alice", post, "delete")
console.log(canDelete.allowed) // false
```

## Core Concepts

### Resources

Resources are the things you want to protect (posts, comments, users, etc.). Create them with:

```typescript
const post = resource<"post">()
const user = resource<"user">()
```

Resource type parameters are just for documentation; they don't affect runtime behavior. Resources are **unique symbols** internally, so two `resource<'post'>()` calls create different resources.

### Roles

Roles group permissions. Create a role and add permissions:

```typescript
const editor = role()
  .permission("read", post)
  .permission("write", post)
  .permission("read", comment)
  .permission("write", comment)
```

The `.permission()` method returns the role for chaining, making it easy to define multiple permissions in one expression.

### Permissions

A permission is an action (string) on a resource:

```typescript
.permission('read', post)   // action: 'read', resource: post
.permission('write', post)  // action: 'write', resource: post
.permission('delete', user) // action: 'delete', resource: user
```

Actions are just strings—you define what they mean for your application (e.g., 'read', 'write', 'delete', 'approve', 'archive').

### Policy

A policy combines roles and role hierarchies:

```typescript
const policy1 = policy([viewer, editor, admin], [])

const policy2 = policy(
  [member, manager, admin],
  [
    { childRole: manager.id, parentRole: admin.id },
    { childRole: member.id, parentRole: manager.id },
  ],
)
```

When you set up role hierarchies (see below), child roles can still be granted independently; hierarchies just allow checking parent permissions.

## Usage Patterns

### Basic Role Assignment

```typescript
const rbac = enforcer(policy([viewer, editor, admin], []))

// Grant role
await rbac.roles(editor.id).grant("alice")

// Check permission
const can = await rbac.enforce("alice", post, "write")

// Revoke role
await rbac.roles(editor.id).revoke("alice")
```

### Querying User Roles and Permissions

```typescript
// Get all roles for alice
const roles = await rbac.users("alice").roles()

// Get all permissions for alice (across all assigned roles)
const perms = await rbac.users("alice").permissions()
```

### Managing Permissions Dynamically

```typescript
// Add a permission to a role
await rbac.roles(editor.id).addPermission("delete", post)

// Remove a permission from a role
await rbac.roles(editor.id).removePermission("delete", post)

// Get all permissions for a role
const permissions = rbac.roles(editor.id).permissions
```

### Role Hierarchies

Role hierarchies let you set up inheritance, where one role can have permissions of another:

```typescript
const member = role().permission("read", post)
const manager = role().permission("approve", post)
const director = role()

const rbacPolicy = policy(
  [member, manager, director],
  [
    { childRole: manager.id, parentRole: director.id },
    { childRole: member.id, parentRole: manager.id },
  ],
)

const rbac = enforcer(rbacPolicy)

// Grant director role to alice
await rbac.roles(director.id).grant("alice")

// Alice can approve posts (director's permission)
let can = await rbac.enforce("alice", post, "approve")
console.log(can.allowed) // true

// But alice doesn't automatically have member's read permission
// unless we also grant the member role or add it to director
can = await rbac.enforce("alice", post, "read")
console.log(can.allowed) // false

// Set up hierarchy: director inherits from manager
await rbac.roles(director.id).derived(manager.id)

// Now grant manager role to bob
await rbac.roles(manager.id).grant("bob")

// Bob can manage (manager) and read (member via hierarchy)
can = await rbac.enforce("bob", post, "approve")
console.log(can.allowed) // true
```

### Custom ID Mappers

By default, RBAC converts entities to strings. If you want custom ID extraction:

```typescript
interface User {
  id: string
  name: string
}

interface Document {
  id: string
  title: string
}

const rbac = enforcer(policy([editor], []), {
  user: (entity: User) => entity.id,
  resource: (entity: Document) => entity.id,
})

const alice: User = { id: "user:123", name: "Alice" }
const doc: Document = { id: "doc:456", title: "My Post" }

const can = await rbac.enforce(alice, doc, "write")
```

## Common Patterns

### Organization-Based RBAC

Create roles per organization:

```typescript
const orgA = "org:a"
const orgB = "org:b"

// Each org has its own role assignments
// Users can have different roles in different orgs

// Alice is admin in org A
await rbac.roles(admin.id).grant(`${orgA}:alice`)

// Alice is editor in org B
await rbac.roles(editor.id).grant(`${orgB}:alice`)

// Check permissions
const canAdminA = await rbac.enforce(`${orgA}:alice`, doc, "delete")
const canAdminB = await rbac.enforce(`${orgB}:alice`, doc, "delete")
```

### Team-Based Hierarchies

Set up teams with inherited permissions:

```typescript
const teamMember = role().permission("read", doc)
const teamLead = role().permission("review", doc)
const manager = role().permission("assign", doc)

const policy = policy(
  [teamMember, teamLead, manager],
  [
    { childRole: teamMember.id, parentRole: teamLead.id },
    { childRole: teamLead.id, parentRole: manager.id },
  ],
)

// A manager has all permissions: assign, review, and read
await rbac.roles(manager.id).grant("bob")
```

### Core-Algebra Fluent Guardrails

For advanced scenarios, combine RBAC permission checks with a core algebra rule for contextual guardrails.

```ts
import {
  createInMemoryAdapter,
  and,
  evaluator,
  not,
  or,
  term,
} from "@tdreyno/he-said"
import { enforcer, policy, resource, role } from "@tdreyno/he-said/rbac"

const document = resource<"document">()
const editor = role().permission("write", document)
const rbac = enforcer(policy([editor], []))

await rbac.roles(editor.id).grant("alice")
const baseDecision = await rbac.enforce("alice", document, "write")

const request = term<{ network: "corp" | "public"; breakGlass: boolean }>()
const baseAllowed = term<boolean>()

const fromCorporateNetwork = request.is(value => value.network === "corp")
const breakGlassDisabled = request.is(value => value.breakGlass === false)

const guardedPolicy = and(
  baseAllowed.is(allowed => allowed),
  or(fromCorporateNetwork, not(breakGlassDisabled)),
)

const evalInstance = evaluator(createInMemoryAdapter({ relations: [] }), {
  evaluatorContext: undefined,
})

const finalAllowed = await evalInstance.evaluate(guardedPolicy, {
  [request]: { network: "corp", breakGlass: false },
  [baseAllowed]: baseDecision.allowed,
})
```

This pattern keeps RBAC as the primary permission model while using core algebra to express contextual controls in a composable way.

Full runnable example:

- `src/rbac/examples/example-core-algebra-fluent.ts`

### Workspace Scoping

Use string IDs to scope roles to workspaces:

```typescript
const workspaceId = "workspace:123"
const userId = "user:alice"
const resourceId = `doc:456:in:${workspaceId}`

await rbac.roles(editor.id).grant(`${workspaceId}:${userId}`)
const can = await rbac.enforce(`${workspaceId}:${userId}`, resourceId, "write")
```

## Error Handling

Permission checks return a `PermissionDecision`:

```typescript
interface PermissionDecision {
  allowed: boolean
  reason?: string
}

const decision = await rbac.enforce("alice", post, "write")

if (!decision.allowed) {
  console.error("Permission denied:", decision.reason)
  // "No matching permission found"
}
```

Always check `.allowed` before granting access.

## Best Practices

1. **Create resources once, reuse them**: Don't create a new resource for every permission check.

   ```typescript
   // Good
   const post = resource<"post">()
   // ... later, reuse it
   const can = await rbac.enforce(user, post, "write")

   // Don't do this
   const can = await rbac.enforce(user, resource<"post">(), "write")
   ```

2. **Use meaningful action names**: Choose action strings that clearly describe what users are doing.

   ```typescript
   // Good
   .permission('read', post)
   .permission('publish', post)
   .permission('archive', post)

   // Unclear
   .permission('action1', post)
   .permission('action2', post)
   ```

3. **Grant roles early, verify permissions in requests**: Don't set up role assignments at request time.

   ```typescript
   // Good: assign roles during signup or onboarding
   await rbac.roles(editor.id).grant("alice")

   // Later, in request handler
   const can = await rbac.enforce("alice", doc, "write")

   // Don't do this: setting up permissions on every request is wasteful
   ```

4. **Use role hierarchies for shared permissions**: If multiple roles share permissions, use inheritance rather than duplicating permissions in each role.

   ```typescript
   // Good
   const member = role().permission("read", doc)
   const lead = role().permission("review", doc)
   // ... then set hierarchy

   // Not as good
   const lead = role()
     .permission("read", doc) // duplicated
     .permission("review", doc)
   ```

5. **Provide reason messages for debugging**: When returning 403 Forbidden, include the reason for logging.
   ```typescript
   const decision = await rbac.enforce(user, resource, action)
   if (!decision.allowed) {
     logger.warn("Permission denied", {
       user,
       resource,
       action,
       reason: decision.reason,
     })
   }
   ```

## Next Steps

- See [RBAC API Reference](./rbac-api.md) for complete method documentation
- Check [Core Concepts](./core-concepts.md) to learn about the underlying algebra system
- View [Working Examples](../src/rbac/examples/) for full, runnable code

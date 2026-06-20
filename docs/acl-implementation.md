# Implementing ACL

This guide shows a simple, real-world ACL model in Rules.

Scenario:

- A company stores documents in shared workspaces.
- Access is granted by explicit ACL entries, not by role.
- Each ACL entry links a user to a document with a permission.
- Permissions are `read`, `write`, or `owner`.
- `owner` implies write and read.
- `write` implies read.

The example keeps ACL explicit and concrete, using relations that match common database tables.

## Domain Model

### Types

```ts
type Permission = "read" | "write" | "owner"

type User = { id: string }
type Document = { id: string; workspaceId: string }
type AclEntry = { id: string }
```

### Terms and Relations

```ts
import { and, eq, oneOf, or, relation, term } from "@tdreyno/rules"

const actor = term<User>()
const document = term<Document>()
const aclEntry = term<AclEntry>()
const aclPermission = term<Permission>()

const aclEntryUser = relation<AclEntry, User>()
const aclEntryDocument = relation<AclEntry, Document>()
const aclEntryPermission = relation<AclEntry, Permission>()
```

## ACL Rules

This section maps plain ACL semantics directly into policy rules.

```ts
const grantsReadPermission = aclPermission.is(value => {
  return value === "read" || value === "write" || value === "owner"
})

const grantsWritePermission = aclPermission.is(value => {
  return value === "write" || value === "owner"
})

const grantsOwnerPermission = aclPermission.is(value => {
  return value === "owner"
})

const canReadDocument = through(aclEntry)
  .to(aclEntryUser, actor)
  .to(aclEntryDocument, document)
  .to(aclEntryPermission, grantsReadPermission)

const canWriteDocument = through(aclEntry)
  .to(aclEntryUser, actor)
  .to(aclEntryDocument, document)
  .to(aclEntryPermission, grantsWritePermission)

const canManageDocument = through(aclEntry)
  .to(aclEntryUser, actor)
  .to(aclEntryDocument, document)
  .to(aclEntryPermission, grantsOwnerPermission)
```

If your endpoint carries a requested action, add an action term and branch once:

```ts
type Action = "read" | "download" | "write" | "manage"

const action = term<Action>()

const canAccessDocument = or(
  and(oneOf(action, ["read", "download"]), canReadDocument),
  and(eq(action, "write"), canWriteDocument),
  and(eq(action, "manage"), canManageDocument),
)
```

## Suggested Migration Path

1. Start from one ACL-backed endpoint, like view document.
2. Model your ACL table as relations: entry to user, entry to document, entry to permission.
3. Define one rule per operation: read, write, manage.
4. Move imperative checks into rule evaluation one endpoint at a time.
5. Add permission inheritance with derived terms instead of scattered conditionals.

## Common Pitfalls

- Treating ACL as a boolean flag and losing permission levels.
- Encoding inheritance in endpoint code instead of rule definitions.
- Forgetting document scope and matching only on user permission.
- Mixing tenant-wide admin bypass logic into ACL rules instead of composing a separate rule.

## Practical Rule of Thumb

Keep ACL close to the data model:

- Relations represent ACL table joins.
- Derived terms represent permission semantics.
- Composed rules represent endpoint decisions.

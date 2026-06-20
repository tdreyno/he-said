# Implementing RBAC

This guide shows a simple, real-world RBAC model in Rules.

Scenario:

- A company has workspaces.
- Users have a role inside each workspace.
- Roles are `owner`, `manager`, or `member`.
- Only owners and managers can invite users.
- Owners can manage billing.
- Project editors can edit projects they own.

The example keeps RBAC explicit and concrete. No generic "ability" term is needed.

## Domain Model

### Types

```ts
type Role = "owner" | "manager" | "member"

type User = { id: string }
type Workspace = { id: string }
type Project = { id: string; workspaceId: string; ownerId: string }
```

### Terms and Relations

```ts
import { and, eq, oneOf, or, relation, term } from "@tdreyno/rules"

const actor = term<User>()
const role = term<Role>()
const workspace = term<Workspace>()
const project = term<Project>()

const userInWorkspace = relation<User, Workspace>()
const userHasWorkspaceRole = relation<User, Role>()
const projectInWorkspace = relation<Project, Workspace>()
const projectOwnedBy = relation<Project, User>()
```

## RBAC Rules

This section maps plain business rules directly into policy rules.

```ts
const canInviteUsers = and(
  userInWorkspace(actor, workspace),
  userHasWorkspaceRole(actor, oneOf(role, ["owner", "manager"])),
)

const canManageBilling = and(
  userInWorkspace(actor, workspace),
  userHasWorkspaceRole(actor, eq(role, "owner")),
)

const canEditProject = and(
  projectInWorkspace(project, workspace),
  userInWorkspace(actor, workspace),
  or(
    userHasWorkspaceRole(actor, eq(role, "owner")),
    and(
      userHasWorkspaceRole(actor, eq(role, "manager")),
      projectOwnedBy(project, actor),
    ),
  ),
)
```

## Suggested Migration Path

1. Start with one business action, like `invite users`.
2. Write one explicit rule with role checks and scope checks.
3. Add facts from your existing membership tables.
4. Replace one endpoint-level `if role === ...` block at a time.
5. Add resource ownership rules where needed.

## Common Pitfalls

- Encoding role checks in application code and data checks in policy code.
- Forgetting workspace scoping while checking roles.
- Modeling ownership as a predicate when it is a relation in your database.

## Practical Rule of Thumb

Keep your RBAC language from the product domain:

- Roles answer who can do this in general.
- Relations answer whether they can do it on this specific resource.

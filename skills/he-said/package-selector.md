# Package selector

Use when deciding which he-said package should be used.

1. Choose `@tdreyno/he-said/rbac` for role-permission centric models.
2. Choose `@tdreyno/he-said/abac` for attribute/action/environment policies.
3. Choose `@tdreyno/he-said/acl` for explicit allow/deny lists with deterministic precedence.
4. Choose core `@tdreyno/he-said` for custom algebra-first composition.
5. Include Postgres adapter guidance when persisted relation facts are required.

References:

- `README.md` RBAC / ABAC / ACL sections
- `docs/rbac-guide.md`
- `docs/abac-guide.md`
- `docs/acl-guide.md`
- `docs/api.md`

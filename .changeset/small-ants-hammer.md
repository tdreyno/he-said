---
"@tdreyno/he-said": minor
---

Add a first-class ACL facade at `@tdreyno/he-said/acl` with explicit allow/deny policy authoring, deterministic deny-first enforcement, typed action/subject/resource identity tokens, and ACL documentation/examples.

This change also removes ABAC batching (`canBatch` / `CanRequest`) to keep decision APIs single-request and consistent with the ACL v1 direction.

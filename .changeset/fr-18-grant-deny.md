---
"@tdreyno/he-said": minor
---

rebac: add `grant.deny()` for actions with no base grant

`grant.deny()` now compiles as an always-false base grant, so actions can be
declared directly in `grants` without hand-built external rules. When `bypass`
is configured for `resourceType(...)` resources, it is still OR'd into the
compiled action rule, enabling bypass-only actions.

---
"@tdreyno/he-said": minor
---

Improve Postgres planner safety and fail-closed behavior guarantees.

- Harden `staticFilters` parameter handling by enforcing placeholder/param consistency and rebinding placeholders safely into the planner parameter stream.
- Expand planner unit coverage for deterministic SQL/params output and explicit fail-closed behavior on unsupported nodes.
- Expand Postgres integration coverage for missing-row denial, nullable-edge traversal denial, and optional parent traversal via explicit `or(...)` relation paths.

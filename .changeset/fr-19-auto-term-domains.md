---
"@tdreyno/he-said": minor
---

rebac/postgres: derive term domains from resource metadata

`scopedPolicy(...).termDomains` now auto-derives Postgres term-domain sources
from table-backed `resourceType(...)` entries. `createPostgresAdapter(...)`
also accepts `resourceTypes` and derives `termDomains` internally, eliminating
manual domain registration loops while preserving explicit `termDomains`
precedence when both are provided.

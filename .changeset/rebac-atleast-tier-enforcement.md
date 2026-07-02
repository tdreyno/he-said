---
"@tdreyno/he-said": patch
---

Fix `@tdreyno/he-said/rebac` tier enforcement so `grant.atLeast(...)` is encoded in the compiled membership rule instead of relying on external `sourceFor(...)` wiring. This closes a fail-open path where lower-tier members could pass higher-tier checks when only base membership mappings were configured, and adds regression coverage across ReBAC, in-memory evaluation, and Postgres planning.

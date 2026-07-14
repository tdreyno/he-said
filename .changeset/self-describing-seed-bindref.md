---
"@tdreyno/he-said": minor
---

Self-describing relations & terms, schema-driven in-memory seed mode, and resource-type inference.

- **Self-describing metadata (core + drizzle):** `relationWithSource(source)`, `attachRelationSource`, and `attachTermDomain` let relations and terms carry their own Postgres source/domain, discovered by the planner when no explicit mapping is configured (explicit config always wins). New drizzle helpers: `idVar(table, label?)` mints a pk-typed term with its domain attached; `fromFk(column, target)` returns a typed self-describing `Relation`, validating `target` against the actual FK constraint.
- **In-memory seed mode:** `createInMemoryAdapter({ relationMappings, termDomains?, seed })` evaluates the same production sources over seeded table rows — source predicates, NULL-join parity, and `exists()` domains all derive from the mappings instead of restated fixture facts. The classic `{ relations, domain }` shape is unchanged.
- **ReBAC resource types:** `InferResourceRow` / `InferResourceContext` / `ResourceRef` inference types, plus `bindRef({ id, context? })` — binds the resource and declared context terms from the id-shaped wire ref, returning `null` (fail-closed) when a declared context value is missing.

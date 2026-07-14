---
"@tdreyno/he-said": minor
---

`idResourceType(table, options)` — the pk-typed sibling of `drizzleResourceType`: environments bind bare primary-key values, so the resource term, ownership paths, grants, and context terms flow as the pk's TS type instead of the full `$inferSelect` row — the library owns that assertion once, eliminating consumer-side narrowing casts. Also threads the `existence` override (composite refs) through to the resource type.

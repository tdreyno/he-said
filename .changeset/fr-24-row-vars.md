---
"@tdreyno/he-said": minor
---

add row-variable Drizzle helpers and unanchored attribute-domain planning

- add `rowVar(table)` to `@tdreyno/he-said/drizzle`, exposing typed `.$` column
  accessors for Drizzle model terms.
- add `rowVarDomain(rowVar)`, `rowVarEncoding(rowVar)`, and
  `bindRowVar(rowVar, value)` to remove string table/column duplication when
  wiring Postgres planner options.
- add `via(navigation)` as an explicit wrapper for relation navigation segments
  used in `through(...)` composition.
- update Postgres planner behavior so `attr(...)` predicates can compile when
  the owning term is initially unbound, as long as a `termDomains` source is
  configured for that term.

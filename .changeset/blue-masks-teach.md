---
"@tdreyno/he-said": minor
---

Add column-addressed attribute predicates with a unified `.is(...)` predicate model across in-memory and Postgres adapters.

- Add SQL-expression predicate support through `term.is(...)` using `attr`, `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `oneOf`, `isNull`, and `isNotNull`.
- Add Postgres planning support for `attr(...)` predicates using `termDomains` as the authoritative row/column mapping surface (`table`, `valueColumn`, `columns`).
- Keep fail-loud planning semantics for non-SQL JavaScript unary predicates in the Postgres adapter.
- Add in-memory evaluation support for expression predicates with parity-focused semantics.
- Update exports, tests, and docs for the new predicate-expression API surface.

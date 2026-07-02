---
"@tdreyno/he-said": minor
---

feat: first-class exists(term) rule

Adds `exists(term)` to the core algebra so policies can explicitly require row
existence without self-edge relations.

- In-memory adapter: `exists(term)` is satisfied when the bound value exists in
  the adapter `domain` or in relation facts touching the term.
- Postgres adapter: `exists(term)` compiles to an `EXISTS(...)` query over the
  configured `termDomains` source using
  `<valueColumn> IS NOT DISTINCT FROM <bound value>`, including source
  `staticFilters` and typed `predicates`.
- Postgres planning fails loud when `exists(term)` is unbound or missing a
  `termDomains` mapping for that term.

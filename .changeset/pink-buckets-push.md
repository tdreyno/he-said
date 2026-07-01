---
"@tdreyno/he-said": minor
---

Add typed, adapter-portable source filtering for relation mappings with role-rank ergonomics.

### Core additions

- Add generic source filter types:
  - `SourcePredicate` (`eq`, `in`, `gt`, `ge`, `lt`, `le`)
  - `SourceOrdering` (explicit ordinal ordering map for rank comparisons)
  - `SourceComparisonOperator`
- Export these core types from the package root.

### Postgres adapter

- Add structured `predicates` and `orderings` support on relation and term-domain sources.
- Compile structured predicates to parameterized SQL.
- Support ordered enum/string threshold comparisons using explicit ordering maps.
- Keep Postgres-prefixed filter types as compatibility aliases to core types.

### In-memory adapter parity

- Add `rows` metadata input for relation facts (`left`, `right`, `columns?`).
- Apply the same structured predicate/order semantics in-memory for test parity with production mappings.

### Documentation and tests

- Add docs for structured filter usage and ordering-based role threshold checks.
- Add unit coverage for typed predicate planning and in-memory predicate parity.

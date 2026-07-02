# Rule modeling

Use when requirements must be translated into typed authorization rules.

1. Map entities to terms and relationship facts to relations.
2. Compose constraints with `and`, `or`, `not`, and `implies`.
3. Extract repeated logic using `letRule` and `ref`.
4. Add relation chains with `through(...).to(...)` when needed.
5. Add quantifiers/cardinality only when explicitly required.

References:

- `docs/core-concepts.md`
- `docs/type-safety-and-terms.md`
- `docs/in-memory-evaluation.md`

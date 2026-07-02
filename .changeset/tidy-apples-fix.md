---
"@tdreyno/he-said": minor
---

Add deterministic deny-path `proof.failing` details to `evaluateWithProof` with adapter parity between in-memory and Postgres.

Highlights:
- New structured `EvaluationProof.failing` payload with stable AST path, kind, and reason.
- Postgres deny-path probing to identify the first unsatisfied node, plus optional failing-node SQL via `includeFailingNodeSql` (off by default).
- Coverage and docs updates for proof behavior and parity expectations.

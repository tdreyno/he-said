---
"@tdreyno/he-said": minor
---

Add first-class fact tokens for core algebra evaluation with identity-keyed fact bags.

Highlights:
- Introduce `fact<T>()` and `factIsTrue(...)` for non-relational, app-computed inputs.
- Allow evaluator input to include `facts` so callers can provide injected values separate from the main environment.
- Export new `Fact` and `EvaluationInput` types and document the new usage.

---
"@tdreyno/he-said": minor
---

`analyzePolicy(rules, { relations? })` — static policy linting: finds OR alternatives subsumed by a more general sibling (dead grants that can never change a verdict), duplicated branches, contradictions buried among other conjuncts (the pure `and(X, not(X))` never-idiom that `grant.deny` compiles to is deliberately exempt), and declared relations no rule references. `ruleEquals` (structural rule equality) is exported alongside.

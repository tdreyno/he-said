---
"@tdreyno/he-said": minor
---

`diffRules(before, after)` — semantic policy diffing at the rule-tree level: added/removed OR alternatives, tightened/loosened grants (AND conjuncts), reorders, and added/removed named rules, all described in policy language via structural summaries. Ideal for CI comments on policy PRs; complements SQL golden snapshots, which churn on planner-only changes.

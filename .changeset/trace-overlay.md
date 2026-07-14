---
"@tdreyno/he-said": minor
---

`traceRuleToMermaid(engine, rule, environment, options?)` renders the decision tree with the ACTUAL evaluation path highlighted: leaf checks are evaluated through the given engine, the traversed route to ALLOW/DENY is drawn with thick edges, and visited decisions get a `path` class — diagram and proof in one artifact for debugging a specific verdict.

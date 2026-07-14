---
"@tdreyno/he-said": minor
---

`bindEnvironment(engine, base)` — principal pre-binding: wrap an evaluator instance with a base environment (the actor and their facts, computed once per request) so every subsequent check supplies only per-check bindings. Call-site bindings win; facts bags merge; `filter()` receives flattened fact bindings. The DX seam for "an engine scoped to this principal".

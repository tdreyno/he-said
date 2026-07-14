---
"@tdreyno/he-said": minor
---

Mermaid flow charts from rule algebra: new `/mermaid` subpath with `ruleToMermaid(rule, options)` and `rulesToMermaid(namedRules, options)` (one subgraph per named rule/action), plus a `he-said-mermaid` CLI that imports a rules module and renders every rule-shaped export — resolving relation and term display names from the module's own exports. Junctions (AND/OR/NOT/GIVEN/FORALL), relation hops with source predicates, existence/fact/equality checks, and rule annotations all render; labels come from name maps, annotations, or symbol descriptions.

---
"@tdreyno/he-said": minor
---

Mermaid rendering is now a decision tree: every check is a yes/no decision node, AND chains follow "yes" edges, OR alternatives receive the "no"-edge fall-throughs, NOT swaps the continuations, and each chart terminates in styled ALLOW/DENY nodes — the diagram reads as the short-circuit evaluation a reviewer would trace, not a boolean-algebra structure. The `he-said-mermaid` CLI emits one mermaid block per rule (with headings) instead of one combined flowchart, keeping each chart far under renderers' per-chart edge limits.

---
"@tdreyno/he-said": minor
---

Errors and diagnostics name their symbols: `relation(pairs?, label?)` accepts a label, `relationWithSource` auto-labels from its source (`table.rightColumn`), and planner errors (missing relation mapping, missing term domain for `exists`/`attr`) include the offending term/relation name via the new exported `describeAlgebraSymbol` helper.

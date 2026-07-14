---
"@tdreyno/he-said": minor
---

Seed-mode safety: the in-memory adapter throws on seed tables no relation source or term domain reads (a typo'd table name previously read as an empty table — deny — letting deny-expecting tests pass for the wrong reason), and the new drizzle `seedFor(tables)` builder accepts compiler-checked camelCase rows (`Partial<$inferSelect>`) and converts them to the column-keyed seed shape.

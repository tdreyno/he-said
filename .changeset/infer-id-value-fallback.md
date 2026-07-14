---
"@tdreyno/he-said": patch
---

`idVar`/`idResourceType` type non-`id` primary keys as `string` instead of `unknown` — the runtime already selects the first PK column (e.g. a `run_id` pk), and the id-string model these APIs serve keys on string ids.

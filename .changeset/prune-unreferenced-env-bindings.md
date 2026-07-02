---
"@tdreyno/he-said": patch
---

Fix Postgres rule planning so unreferenced environment terms are no longer bound as dangling SQL parameters. This prevents `42P18` errors when evaluating rules with a shared environment shape and adds regression coverage across planning and prepared evaluation paths.

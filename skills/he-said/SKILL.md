---
name: he-said-guide
description: End-to-end guide for onboarding, rule modeling, and package choice in he-said.
disable-model-invocation: true
---

Use this skill when building or reviewing authorization with he-said.

## Required inputs

- Domain entities and the authorization decision to make.
- Preferred model (RBAC, ABAC, ACL, or algebra-first core), if known.
- Whether evaluation is in-memory only or may use Postgres-backed relations.

## Workflow

1. Start with `quickstart.md` to produce a minimal, working first rule.
2. Use `rule-modeling.md` to translate requirements into typed, composable constraints.
3. Use `package-selector.md` to select the package/API surface that best fits the model.
4. Produce a starter implementation with one allowed and one denied example.

## Guardrails

- Keep policy logic in named rules, not route-handler conditionals.
- Prefer explicit deny conditions for blocking states.
- Preserve package semantics (especially ACL/ABAC deny precedence).

## Local references

- `quickstart.md`
- `rule-modeling.md`
- `package-selector.md`

# @tdreyno/rules

A constructor-only, ReBAC-first authorization library.

## API

- `ability(name, options?)`
- `or(...abilities)`
- `and(...abilities)`
- `not(ability)`

Instances expose only:

- `can(context, deps?)`

## Example

```ts
import { ability, and } from "@tdreyno/rules"

const canEditDocument = ability("canEditDocument", {
  description: "Can edit own document",
  where: ({ action }) => action === "edit",
  relation: ({ subject, resource }) => ({
    subject: `user:${subject.id}`,
    relation: "owner",
    object: `document:${resource.id}`,
  }),
})

const isNotSuspended = ability("isNotSuspended", {
  where: ({ subject }) => !subject.suspended,
})

const policy = and(canEditDocument, isNotSuspended)

const allowed = await policy.can(
  {
    subject: { id: "u1", suspended: false },
    action: "edit",
    resource: { id: "d1" },
    environment: {},
  },
  {
    hasRelation: async tuple => tuple.relation === "owner",
  },
)
```

## Repository Context

This section captures project decisions and workflow expectations for future sessions.

### Product and API Contract

- Constructor-only API. No builder pattern, and no build/commit lifecycle in public API.
- Ability signature is fixed to `ability(name, options?)`.
- `name` is required and `options` is optional.
- `description` is the supported metadata field name (not `reason`).
- Public execution surface is `can(context, deps?)` only.
- Do not add `cannot` or `evaluate` unless explicitly requested.
- Composition names are fixed to `or`, `and`, and `not` with no aliases.
- Backward compatibility wrappers are intentionally out of scope.
- Domain grouping is external to this library (consumer-managed registries/maps).
- ReBAC-first checks are first-class; generic `where` predicates remain supported.

### Runtime Behavior Expectations

- `ability(name, options?)` validates and trims `name`.
- Relation checks deny by default when relation constraints exist but no resolver is provided.
- `where` supports sync and async predicates.
- `relation` supports tuple values, arrays of tuples, functions of context, async functions, and mixed arrays.

### Source Layout

- `src/index.ts`
- `src/core/types.ts`
- `src/core/ability.ts`
- `src/core/policy.ts`
- `src/core/instance.ts`
- `src/core/task.ts`
- `src/core/planner.ts`
- `src/core/interpreter.ts`
- `src/core/executor.ts`
- `src/core/rebac.ts`
- `test/ability.test.ts`
- `test/ability.typecheck.ts`

### Validation Workflow

Run all of the following before concluding work:

- `npm run build`
- `npm test`
- `npm run test:types`

Recommended full local gate (Fizz-style):

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:ci`
- `npm run test:types`

Notes:

- Runtime tests live in `test/ability.test.ts`.
- Compile-time type assertions live in `test/ability.typecheck.ts` and are validated via `test:types`.
- Keep typecheck files out of Jest test filename patterns (`*.test.ts`) to avoid runtime test failures.

### Suggested Next Technical Focus

- Further harden relation typing for complex array/function combinations.
- Add docs for the `deps` contract with concrete ReBAC resolver examples.
- Add performance tests for deep policy composition trees.

## Tooling and Release Workflow

This repository follows the same local pattern as Fizz for tooling, testing, versioning, and publishing.

### Tooling Scripts

- `npm run format` formats TypeScript/JavaScript/JSON/Markdown with Prettier.
- `npm run lint` runs ESLint.
- `npm run lint:fix` runs ESLint with auto-fixes.
- `npm run typecheck` runs TypeScript no-emit checking.
- `npm run clean` removes build output.

### Testing and Build Scripts

- `npm run build` compiles to `dist`.
- `npm test` runs Jest tests.
- `npm run test:ci` runs Jest in CI mode with coverage.
- `npm run test:types` runs compile-time type assertion checks.

### Changesets Versioning

- `.changeset/config.json` is configured for `main` as the base branch.
- `npm run changeset` creates pending version entries.
- `changeset version` updates package versions and changelog content.

### Publishing

- Package publishes with `publishConfig.access` set to `public`.
- `npm run release` runs build, lint, tests, type tests, then executes `changeset version` and `changeset publish`.
- GitHub Actions are intentionally not configured in this repository at this stage.

# @tdreyno/he-said

## 0.9.1

### Patch Changes

- 65b7424: Resource-type terms are labeled with their table name, so deny proofs, debuggers, and mermaid diagrams show `exists(systems)` instead of an anonymous term.

## 0.9.0

### Minor Changes

- 7575e92: Mermaid flow charts from rule algebra: new `/mermaid` subpath with `ruleToMermaid(rule, options)` and `rulesToMermaid(namedRules, options)` (one subgraph per named rule/action), plus a `he-said-mermaid` CLI that imports a rules module and renders every rule-shaped export — resolving relation and term display names from the module's own exports. Junctions (AND/OR/NOT/GIVEN/FORALL), relation hops with source predicates, existence/fact/equality checks, and rule annotations all render; labels come from name maps, annotations, or symbol descriptions.

## 0.8.0

### Minor Changes

- a615b31: Self-describing relations & terms, schema-driven in-memory seed mode, and resource-type inference.

  - **Self-describing metadata (core + drizzle):** `relationWithSource(source)`, `attachRelationSource`, and `attachTermDomain` let relations and terms carry their own Postgres source/domain, discovered by the planner when no explicit mapping is configured (explicit config always wins). New drizzle helpers: `idVar(table, label?)` mints a pk-typed term with its domain attached; `fromFk(column, target)` returns a typed self-describing `Relation`, validating `target` against the actual FK constraint.
  - **In-memory seed mode:** `createInMemoryAdapter({ relationMappings, termDomains?, seed })` evaluates the same production sources over seeded table rows — source predicates, NULL-join parity, and `exists()` domains all derive from the mappings instead of restated fixture facts. The classic `{ relations, domain }` shape is unchanged.
  - **ReBAC resource types:** `InferResourceRow` / `InferResourceContext` / `ResourceRef` inference types, plus `bindRef({ id, context? })` — binds the resource and declared context terms from the id-shaped wire ref, returning `null` (fail-closed) when a declared context value is missing.

## 0.7.0

### Minor Changes

- 9656dd0: Add `edge(leftColumnRef, rightColumnRef, options?)` to
  `@tdreyno/he-said/drizzle` for typed same-table relation sources when
  `fromFk(...)` inference cannot apply.

## 0.6.1

### Patch Changes

- a449ce1: Fix postgres `filter(..., { candidates })` for typed term domains by using a domain-table `ANY(...)` candidate query instead of untyped `VALUES`, preventing `uuid = text` errors. Adds unit and integration regression coverage for UUID-backed domains.

## 0.6.0

### Minor Changes

- 2951775: add row-variable Drizzle helpers and unanchored attribute-domain planning

  - add `rowVar(table)` to `@tdreyno/he-said/drizzle`, exposing typed `.$` column
    accessors for Drizzle model terms.
  - add `edge(leftColumnRef, rightColumnRef, options?)` to
    `@tdreyno/he-said/drizzle` for explicit typed same-table relation sources when
    `fromFk(...)` inference cannot apply.
  - add `rowVarDomain(rowVar)`, `rowVarEncoding(rowVar)`, and
    `bindRowVar(rowVar, value)` to remove string table/column duplication when
    wiring Postgres planner options.
  - add `via(navigation)` as an explicit wrapper for relation navigation segments
    used in `through(...)` composition.
  - update Postgres planner behavior so `attr(...)` predicates can compile when
    the owning term is initially unbound, as long as a `termDomains` source is
    configured for that term.

## 0.5.0

### Minor Changes

- 69c675b: rebac: add `grant.deny()` for actions with no base grant

  `grant.deny()` now compiles as an always-false base grant, so actions can be
  declared directly in `grants` without hand-built external rules. When `bypass`
  is configured for `resourceType(...)` resources, it is still OR'd into the
  compiled action rule, enabling bypass-only actions.

- f926e22: rebac/postgres: derive term domains from resource metadata

  `scopedPolicy(...).termDomains` now auto-derives Postgres term-domain sources
  from table-backed `resourceType(...)` entries. `createPostgresAdapter(...)`
  also accepts `resourceTypes` and derives `termDomains` internally, eliminating
  manual domain registration loops while preserving explicit `termDomains`
  precedence when both are provided.

- aebea68: rebac: add bindable through anchors and custom composite existence rules

  `through(...)` now supports anchored intermediate hops via
  `through(relA).at(term).through(relB, ...)`, allowing callers to bind
  composite-path intermediates from context terms.

  `resourceType(...)` now accepts `existence(resource, context)` so
  `resource.exists()` can be made composite-aware when id-only existence is too
  weak.

- 0e6294f: add `@tdreyno/he-said/drizzle` bridge utilities

  Introduces a new Drizzle subpath export with schema-driven helpers:

  - `fromFk(columnRef)` for FK-derived relation sources
  - `associatesTable(table, { left, right, predicates })`
  - `inColumn(columnRef, values)` typed predicate helper
  - `drizzleResourceType(table, { owner, contextTerms, fixed })` with composite
    PK context/fixed validation
  - `drizzleExecutor(db)` adapter bridge for Drizzle-backed query execution

  Also adds package export wiring and optional peer dependency metadata for
  `drizzle-orm`.

### Patch Changes

- 2be6cb6: docs(rebac): document ownership-rule reuse via `resourceType().ownedBy()`

  Records FR-20 closure by documenting the shipped ownership export path:
  `resourceType(...).ownedBy(scopeTerm)`.

## 0.4.0

### Minor Changes

- a41b5e6: Add `resourceType()` — first-class resource type declarations (FR-22)

  Introduces `resourceType<T>(options)` as a unified object that replaces the parallel maps adopters previously maintained per resource type. Each `ResourceType` bundles its algebra term, backing table/key metadata, optional composite-key context terms, and ownership path into a single declaration.

  **New API** (`@tdreyno/he-said/rebac`):

  ```ts
  import { resourceType } from "@tdreyno/he-said/rebac"

  const File = resourceType<{ id: string }, Team>({
    table: "files",
    key: "id",
    owner: either(through(fileInProject, projectInTeam), through(fileInTeam)),
  })

  // Standalone helpers — no policy needed:
  File.exists() // existence Rule (wraps core exists())
  File.ownedBy(teamTerm) // ownership Rule
  File.bind({ id: "f1" }) // Environment fragment for evaluate()
  ```

  `scopedPolicy` now accepts `ResourceType` objects directly in `resources` (still fully backwards-compatible with bare `ScopePath`):

  ```ts
  const policy = scopedPolicy({
    resources: { File },                             // ResourceType IS the config
    bypass: ({ resource }) => and(factIsTrue(isAppAdmin), resource.exists()), // FR-18
    ...
  })
  ```

  - `bypass` is an optional policy-level function that is OR'd with the normal rule for each `ResourceType` resource, enabling admin bypasses without per-action overrides.
  - `can()` automatically extracts context-term bindings via `bind()` when the resource entry is a `ResourceType`.
  - `ResourceType.term` is the canonical term symbol — identical to `policy.resourceTerms[key]`, so rules built outside the policy stay compatible.

## 0.3.1

### Patch Changes

- 4fde42c: Require `factIsTrue(...)` facts to be explicitly bound during evaluation and planning. Unbound facts now throw instead of silently matching, including in `or`/`not` branches, with regression coverage for in-memory and Postgres adapters plus prepared fact override behavior.
- 6f3dce9: Fix Postgres rule planning so unreferenced environment terms are no longer bound as dangling SQL parameters. This prevents `42P18` errors when evaluating rules with a shared environment shape and adds regression coverage across planning and prepared evaluation paths.
- 5c42b6d: Fix `@tdreyno/he-said/rebac` tier enforcement so `grant.atLeast(...)` is encoded in the compiled membership rule instead of relying on external `sourceFor(...)` wiring. This closes a fail-open path where lower-tier members could pass higher-tier checks when only base membership mappings were configured, and adds regression coverage across ReBAC, in-memory evaluation, and Postgres planning.

## 0.3.0

### Minor Changes

- 4880793: feat: colocated relation definitions

  `relation<Left, Right>()` now accepts an optional `pairs` argument so you can
  define relation data alongside the relation itself:

  ```ts
  const userOwnsDocument = relation<User, Document>([
    [u1, d1],
    [u2, d1],
  ])
  ```

  `createInMemoryAdapter` accepts `Relation` objects directly in the `relations`
  array (in addition to the existing `InMemoryRelationFacts` shape), using the
  colocated pairs automatically:

  ```ts
  createInMemoryAdapter({
    relations: [userOwnsDocument],
    domain: [u1, u2, d1],
  })
  ```

  Both styles can be mixed freely in a single adapter instance.

- e6e5b8a: feat: first-class exists(term) rule

  Adds `exists(term)` to the core algebra so policies can explicitly require row
  existence without self-edge relations.

  - In-memory adapter: `exists(term)` is satisfied when the bound value exists in
    the adapter `domain` or in relation facts touching the term.
  - Postgres adapter: `exists(term)` compiles to an `EXISTS(...)` query over the
    configured `termDomains` source using
    `<valueColumn> IS NOT DISTINCT FROM <bound value>`, including source
    `staticFilters` and typed `predicates`.
  - Postgres planning fails loud when `exists(term)` is unbound or missing a
    `termDomains` mapping for that term.

## 0.2.0

### Minor Changes

- e4ffa40: Add column-addressed attribute predicates with a unified `.is(...)` predicate model across in-memory and Postgres adapters.

  - Add SQL-expression predicate support through `term.is(...)` using `attr`, `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `oneOf`, `isNull`, and `isNotNull`.
  - Add Postgres planning support for `attr(...)` predicates using `termDomains` as the authoritative row/column mapping surface (`table`, `valueColumn`, `columns`).
  - Keep fail-loud planning semantics for non-SQL JavaScript unary predicates in the Postgres adapter.
  - Add in-memory evaluation support for expression predicates with parity-focused semantics.
  - Update exports, tests, and docs for the new predicate-expression API surface.

- 6b509b0: Initial public release of `@tdreyno/he-said`.

  Highlights:
  - Constructor-based, composable authorization rule algebra.
  - Typed terms, relations, and logical operators (`and`, `or`, `not`, `eq`, `forAll`, `select`, `distinct`, `memo`, `ref`).
  - In-memory evaluator adapter with proof details and stratified-negation validation.
  - TypeScript-first API surface and compile-time type assertion coverage.

- 0f75191: Add first-party skills.sh support with a consolidated `he-said-guide` skill and in-folder reference docs for quickstart, rule modeling, and package selection.

  This also documents skills installation in the README and adds lock metadata so consumer agents can reliably install from `tdreyno/he-said`.

- bb52be8: Add first-class fact tokens for core algebra evaluation with identity-keyed fact bags.

  Highlights:
  - Introduce `fact<T>()` and `factIsTrue(...)` for non-relational, app-computed inputs.
  - Allow evaluator input to include `facts` so callers can provide injected values separate from the main environment.
  - Export new `Fact` and `EvaluationInput` types and document the new usage.

- 1a12dd6: Add set-returning authorization support with `instance.filter(...)` across in-memory and Postgres adapters, plus `planPostgresPredicate(...)` for composable parameterized `EXISTS(...)` SQL fragments.

  This also adds tests and docs updates for batch authorization flows and predicate composition.

- 267bd67: Fix Postgres `staticFilters` parameter placeholder binding by rewriting local `$n` placeholders to the correct global parameter positions during query planning.

  This closes a correctness gap where parameterized static filters could bind to unrelated earlier parameters from environment bindings or other predicates.

- 041893d: Add RBAC (Role-Based Access Control) package with fluent API for role and permission management.

  **New exports** (`@tdreyno/he-said/rbac`):
  - `resource<T>()`: Create unique resource primitives
  - `role<T>()`: Create roles with fluent `.permission()` chaining
  - `policy(roles[], hierarchies?)`: Compile roles and hierarchies into a policy
  - `enforcer(policy, idMappers?)`: Create RBAC enforcer instance
  - `RBACEnforcer<U, R, C>`: Main enforcer interface with `.enforce()`, `.users()`, `.roles()` fluent APIs

  **Key features**:
  - Symbol-based resource and role identity for type-safe matching
  - In-memory fact storage with role hierarchies support
  - Fluent API for role assignment, permission management, and user queries
  - Support for multi-tenancy via custom ID mappers

  **Core algebra enhancements**:
  - `derives(entity, from)`: Model transitive entity relationships (role hierarchies, permission delegation)
  - `given(rule, context)`: Scope rules to contexts (workspaces, time windows, conditions)
  - Both primitives are pattern-agnostic and work with RBAC, ABAC, and ReBAC equally

  **Documentation**:
  - `docs/rbac-guide.md`: Comprehensive guide covering core concepts, usage patterns, and best practices
  - `docs/rbac-api.md`: Complete API reference with signatures, parameters, and examples
  - `examples/rbac/`: Three working examples (basic, hierarchy, multi-tenancy)
  - Updated `docs/core-concepts.md` with derives/given documentation

  **Package updates**:
  - Added `exports` field in `package.json` for subpath support (`@tdreyno/he-said/rbac`)
  - Updated `README.md` with RBAC section and documentation links

- 606d995: Add typed, adapter-portable source filtering for relation mappings with role-rank ergonomics.

  ### Core additions
  - Add generic source filter types:
    - `SourcePredicate` (`eq`, `in`, `gt`, `ge`, `lt`, `le`)
    - `SourceOrdering` (explicit ordinal ordering map for rank comparisons)
    - `SourceComparisonOperator`
  - Export these core types from the package root.

  ### Postgres adapter
  - Add structured `predicates` and `orderings` support on relation and term-domain sources.
  - Compile structured predicates to parameterized SQL.
  - Support ordered enum/string threshold comparisons using explicit ordering maps.
  - Keep Postgres-prefixed filter types as compatibility aliases to core types.

  ### In-memory adapter parity
  - Add `rows` metadata input for relation facts (`left`, `right`, `columns?`).
  - Apply the same structured predicate/order semantics in-memory for test parity with production mappings.

  ### Documentation and tests
  - Add docs for structured filter usage and ordering-based role threshold checks.
  - Add unit coverage for typed predicate planning and in-memory predicate parity.

- ae0e7bb: Add a prepared evaluator API (`prepare`) for request-scoped principal caching, including Postgres relation preloading and reuse across repeated evaluations.
- 36db3a8: Add a first-class ACL facade at `@tdreyno/he-said/acl` with explicit allow/deny policy authoring, deterministic deny-first enforcement, typed action/subject/resource identity tokens, and ACL documentation/examples.

  This change also removes ABAC batching (`canBatch` / `CanRequest`) to keep decision APIs single-request and consistent with the ACL v1 direction.

- 80cf7c8: Add deterministic deny-path `proof.failing` details to `evaluateWithProof` with adapter parity between in-memory and Postgres.

  Highlights:
  - New structured `EvaluationProof.failing` payload with stable AST path, kind, and reason.
  - Postgres deny-path probing to identify the first unsatisfied node, plus optional failing-node SQL via `includeFailingNodeSql` (off by default).
  - Coverage and docs updates for proof behavior and parity expectations.

- 260d7e3: Improve Postgres planner safety and fail-closed behavior guarantees.

  - Harden `staticFilters` parameter handling by enforcing placeholder/param consistency and rebinding placeholders safely into the planner parameter stream.
  - Expand planner unit coverage for deterministic SQL/params output and explicit fail-closed behavior on unsupported nodes.
  - Expand Postgres integration coverage for missing-row denial, nullable-edge traversal denial, and optional parent traversal via explicit `or(...)` relation paths.

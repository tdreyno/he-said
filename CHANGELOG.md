# @tdreyno/he-said

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

# API Documentation

## Exports

he-said exports algebra constructors, an in-memory adapter, and related types.

Package subpaths:

- `@tdreyno/he-said/rbac`
- `@tdreyno/he-said/abac`
- `@tdreyno/he-said/acl`
- `@tdreyno/he-said/rebac`

### Algebra Constructors

- term<T>()
- term<T>().is(jsPredicateOrExpression)
- fact<T>(labelOrOptions?)
- factIsTrue(factToken)
- attr(term, "column")
- relation<Left, Right>()
- exists(term)
- eq(leftTerm, rightTermOrValue)
- eq(attr(...), attr(...) | value)
- ne / gt / ge / lt / le
- isNull / isNotNull
- ref(name)
- and(...constraints)
- or(...constraints)
- not(constraint)
- implies(premise, consequence)
- oneOf(term, values)
- oneOf(attr(...), values)
- atLeast(count, ...constraints)
- atMost(count, ...constraints)
- exactly(count, ...constraints)
- forAll(term, constraint)
- select(...terms)(constraint)
- distinct(constraint)
- letRule(name, constraint)

### Evaluator Construction

- evaluator(adapter, { evaluatorContext })

Returns an EvaluatorInstance with:

- evaluate(rule, environmentOrInput): Promise<boolean>
- evaluateWithProof(rule, environmentOrInput): Promise<EvaluationProof>
  - EvaluationProof.ok: boolean result
  - EvaluationProof.failing?: first unsatisfied node when denied
    - kind: failing node category
    - path: deterministic AST path (for stable assertions/logging)
    - reason: concise failure reason
    - relationId?: set for relation-node failures
    - sql?/paramCount?: available for Postgres only when `includeFailingNodeSql` is enabled
- filter(rule, { environment, term, candidates? }): Promise<ReadonlyArray<T>>

`environmentOrInput` accepts either a plain environment object, or an object with
an optional `facts` bag keyed by fact token identity.

Facts input shape:

```ts
{
  [viewer]: user,
  facts: {
    [isAppAdmin]: true,
  },
}
```

`facts` values are merged into evaluation bindings by token identity. If a token appears
both at the top level and in `facts`, the `facts` value wins.

### In-Memory Adapter

- createInMemoryAdapter(options)
- validateStratifiedNegation(rule)

InMemoryAdapterOptions:

- relations: array of { relation, pairs }
- domain: optional fallback candidate domain
- relation entries may also include:
  - rows: array of { left, right, columns? }
  - predicates: typed filters (`eq`, `in`, `gt`, `ge`, `lt`, `le`)
  - orderings: per-column rank maps for ordered comparisons

### Postgres Adapter

- createPostgresAdapter(options)
- planPostgresRule(rule, options)
- planPostgresPredicate(rule, options)

Postgres relation/domain sources support:

- staticFilters (legacy SQL snippets)
- predicates (typed, parameterized source predicates)
- orderings (per-column rank maps for enum/string thresholds)
- `createPostgresAdapter({ resourceTypes })` to derive `termDomains` from
  table-backed resource declarations (`term` + `table` + `key`)

### ReBAC Facade (`@tdreyno/he-said/rebac`)

- `roleTiers(...levels)`
- `grant.atLeast(level)`
- `grant.readScope()`
- `grant.deny()`
- `through(relA, relB, ...)`
- `through(relA).at(term).through(relB, ...)`
- `either(pathA, pathB, ...)`
- `scopedPolicy(config)`

`scopedPolicy` compiles declarative scope/membership/resource grants into core
algebra rules and returns:

- `ruleFor(action, resourceType)`
- `roleRequirementFor(action, resourceType)`
- `termDomains` (auto-derived from table-backed `resourceType(...)` entries)
- `sourceFor(action, resourceType, source)` (optional source pushdown mirror for tier predicates/orderings)
- `can(...)` when initialized with `evaluator`

### Drizzle Bridge (`@tdreyno/he-said/drizzle`)

- `fromFk(columnRef)`
- `associatesTable(table, { left, right, predicates? })`
- `inColumn(columnRef, values)`
- `drizzleResourceType(table, { owner, contextTerms?, fixed? })`
- `rowVar(table)` (typed term + `.$` typed attribute accessors)
- `rowVarDomain(rowVar)` (planner `termDomains` entry without string duplication)
- `rowVarEncoding(rowVar)` (term encoder keyed by the row variable's selected PK)
- `bindRowVar(rowVar, value)` (environment fragment keyed by row variable PK)
- `via(navigation)` (explicit relation-navigation wrapper for `through(...)`)
- `drizzleExecutor(db)`

## Key Types

- Environment
- Rule
- Term<T>
- Fact<T>
- Relation<Left, Right>
- UnaryPredicate<T, Env>
- EvaluatorAdapter<Env, EvaluatorContext>
- EvaluatorInstance<Env>
- FilterOptions<Env, T>
- EvaluationProof
- InMemoryRelationFacts<Left, Right>
- InMemoryRelationRow<Left, Right>
- InMemoryAdapterOptions
- SourcePredicate
- SourceOrdering
- PostgresSourcePredicate (adapter alias of SourcePredicate)
- PostgresSourceOrdering (adapter alias of SourceOrdering)

## Rule Notes

- Rule trees are immutable plain objects.
- and and or flatten nested nodes of the same kind.
- oneOf(term, values) is equivalent to or(eq(term, v1), eq(term, v2), ...).
- exists(term) checks row/domain existence for a bound term (useful for fail-closed admin bypass guards).
- SQL-safe predicate expressions are attached through term.is(...), for example: term.is(eq(attr(term, "status"), "active")).
- `attr(...)` predicates can self-anchor unbound terms when `termDomains` includes
  that term (for example via `rowVarDomain(...)`).
- cardinality helpers count satisfied constraints:
  - atLeast(n, ...rules)
  - atMost(n, ...rules)
  - exactly(n, ...rules)
- ref and letRule names must be non-empty after trim.

## Error Conditions

- unknown term used in rule expression
- ref name is required
- letRule name is required
- atLeast requires a non-negative integer count
- atMost requires a non-negative integer count
- exactly requires a non-negative integer count
- unknown ref during evaluation/validation
- recursive or non-stratified negative dependencies

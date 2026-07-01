# API Documentation

## Exports

he-said exports algebra constructors, an in-memory adapter, and related types.

### Algebra Constructors

- term<T>()
- term<T>().is(predicate)
- fact<T>()
- factIsTrue(factToken)
- relation<Left, Right>()
- eq(leftTerm, rightTermOrValue)
- ref(name)
- and(...constraints)
- or(...constraints)
- not(constraint)
- implies(premise, consequence)
- oneOf(term, values)
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

`environmentOrInput` accepts either a plain environment object, or an object with
an optional `facts` bag keyed by fact token identity.

### In-Memory Adapter

- createInMemoryAdapter(options)
- validateStratifiedNegation(rule)

InMemoryAdapterOptions:

- relations: array of { relation, pairs }
- domain: optional fallback candidate domain

## Key Types

- Environment
- Rule
- Term<T>
- Fact<T>
- Relation<Left, Right>
- UnaryPredicate<T, Env>
- EvaluatorAdapter<Env, EvaluatorContext>
- EvaluatorInstance<Env>
- EvaluationProof
- InMemoryRelationFacts<Left, Right>
- InMemoryAdapterOptions

## Rule Notes

- Rule trees are immutable plain objects.
- and and or flatten nested nodes of the same kind.
- oneOf(term, values) is equivalent to or(eq(term, v1), eq(term, v2), ...).
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

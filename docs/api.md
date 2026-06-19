# API Documentation

## Exports

ABAC exports algebra constructors, an in-memory adapter, and related types.

### Algebra Constructors

- term<T>()
- relation<Left, Right>()
- is(term, predicate)
- eq(leftTerm, rightTermOrValue)
- ref(name)
- and(...constraints)
- or(...constraints)
- not(constraint)
- forAll(term, constraint)
- select(...terms)(constraint)
- distinct(constraint)
- memo(name, constraint)

### Evaluator Construction

- evaluator(adapter, { evaluatorContext })

Returns an EvaluatorInstance with:

- evaluate(rule, environment): Promise<boolean>
- evaluateWithProof(rule, environment): Promise<EvaluationProof>

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
- ref and memo names must be non-empty after trim.

## Error Conditions

- unknown term used in rule expression
- ref name is required
- memo name is required
- unknown ref during evaluation/validation
- recursive or non-stratified negative dependencies

# In-Memory Evaluation

ABAC ships an in-memory adapter for local authorization checks and testing.

## createInMemoryAdapter

createInMemoryAdapter takes relation facts and an optional global domain:

```ts
import { createInMemoryAdapter } from "abac"

const adapter = createInMemoryAdapter({
  relations: [
    {
      relation: owns,
      pairs: [
        [userA, doc1],
        [userB, doc2],
      ],
    },
  ],
  domain: [userA, userB, doc1, doc2],
})
```

## Building an Evaluator

```ts
import { evaluator } from "abac"

const engine = evaluator(adapter, {
  evaluatorContext: undefined,
})

const ok = await engine.evaluate(rule, environment)
const proof = await engine.evaluateWithProof(rule, environment)
```

## Stratified Negation Validation

The in-memory adapter validates ref and memo graphs before evaluation:

- unknown refs throw an error.
- recursive references throw an error.
- negative recursive dependencies throw an error.

You can also call validateStratifiedNegation(rule) directly.

## Adapter Proof Details

In-memory proofs include details that help debug rule execution:

- matchCount
- selectApplied
- distinctApplied
- memoHits
- memoMisses

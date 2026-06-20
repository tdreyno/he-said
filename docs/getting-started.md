# Getting Started

Rules is a small TypeScript library for expressing authorization as composable logic rules.

## Install

```bash
npm install @tdreyno/rules
```

## First Rule

```ts
import {
  and,
  createInMemoryAdapter,
  evaluator,
  is,
  oneOf,
  or,
  relation,
  term,
} from "@tdreyno/rules"

type User = { id: string; suspended: boolean }
type Document = { id: string }

const user = term<User>()
const document = term<Document>()

const owns = relation<User, Document>()

const canEdit = and(owns(user, document))

const engine = evaluator(
  createInMemoryAdapter({
    relations: [
      {
        relation: owns,
        pairs: [[{ id: "u1", suspended: false }, { id: "d1" }]],
      },
    ],
  }),
  { evaluatorContext: undefined },
)

const allowed = await engine.evaluate(canEdit, {
  [user]: { id: "u1", suspended: false },
  [document]: { id: "d1" },
})
```

## Typical Workflow

1. Create typed terms with term().
2. Define reusable relations with relation().
3. Build a rule tree with composable operators:
   - Logic: and, or, not, implies
   - Helpers: oneOf, atLeast, atMost, exactly
   - Equality and predicates: eq, is
   - Advanced: forAll, select, distinct, letRule, ref
4. Choose an evaluator adapter.
5. Call evaluate or evaluateWithProof.

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run test:ci
npm run test:types
```

# Getting Started

he-said is a small TypeScript library for expressing authorization as composable logic rules.

## Install

```bash
npm install @tdreyno/he-said
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
} from "@tdreyno/he-said"

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

## Injected Facts (Identity-Keyed)

Use facts for app-computed booleans/scalars that are not relation data.

```ts
import { fact, factIsTrue, or } from "@tdreyno/he-said"

const isAppAdmin = fact<boolean>()
const canManage = or(factIsTrue(isAppAdmin), canEdit)

const allowed = await engine.evaluate(canManage, {
  [user]: { id: "u1", suspended: false },
  [document]: { id: "d1" },
  facts: {
    [isAppAdmin]: true,
  },
})
```

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run test:ci
npm run test:types
```

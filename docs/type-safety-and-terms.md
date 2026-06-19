# Type Safety and Terms

ABAC is designed around strongly typed terms and relation signatures.

## Why Terms Are Symbols

term<T>() returns a unique symbol branded with T.

Benefits:

- no accidental string key collisions
- clear, static pairing between terms and values
- safe relation signatures through TypeScript

## Predicates with is

is(termValue, predicate) creates a derived term with additional unary filtering.

```ts
import { is, term } from "abac"

type User = { id: string; suspended: boolean }

const user = term<User>()
const activeUser = is(user, candidate => !candidate.suspended)
```

Derived terms can be reused in relation and equality expressions.

## Equality and Binding

eq(leftTerm, rightTermOrValue) supports:

- term-to-term equality
- term-to-value equality

If one side is not bound in the current environment, evaluation may bind it.

## Compile-Time Assertions

This repository includes compile-time type tests in test/algebra.typecheck.ts.

Run:

```bash
npm run test:types
```

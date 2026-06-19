# F.A.Q.

## Is this policy engine ABAC-only?

It is rule-algebra based. You can express ABAC, ReBAC-style checks, and mixed constraints.

## Why are terms symbols instead of strings?

Symbols avoid collisions and preserve strong typing in TypeScript.

## Do I have to use the in-memory adapter?

No. evaluator(...) accepts any adapter that implements EvaluatorAdapter.

## Can predicates be async?

Yes. Unary predicates can return boolean or Promise<boolean>.

## What does evaluateWithProof provide?

It returns ok, the evaluated rule, and optional adapter-specific details.

## How do I validate recursive rule references?

Use validateStratifiedNegation(rule) before evaluation if you want explicit validation.

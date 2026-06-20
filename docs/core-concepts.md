# Core Concepts

Rules models authorization as rule algebra over typed terms.

## Terms

Use term() to create symbolic variables that participate in rules.

- Terms are symbols, not runtime strings.
- Type information flows through each term.
- Derived terms created with term.is(...) keep the same root term and add predicate filters.

## Relations

Use relation<Left, Right>() to define graph edges between typed terms.

- A relation returns a rule node when applied: relation(leftTerm, rightTerm).
- Each relation has a unique relation id used by evaluator adapters.

## Rule Composition

Rules supports logical and structural operators:

- and(...constraints)
- or(...constraints)
- not(constraint)
- implies(premise, consequence)
- eq(term, termOrValue)
- oneOf(term, values)
- atLeast(count, ...constraints)
- atMost(count, ...constraints)
- exactly(count, ...constraints)
- forAll(term, constraint)
- select(...terms)(constraint)
- distinct(constraint)
- letRule(name, constraint)
- ref(name)

These operators produce plain rule trees that adapters evaluate.

## Environments

Evaluation receives an environment object with bindings for term symbols and optional string keys.

Examples:

- Bind a user term to a concrete user value.
- Pass extra context fields as string keys for predicates.

## Proofs

evaluateWithProof returns an EvaluationProof object.

- ok indicates whether at least one environment matched.
- rule includes the evaluated rule tree.
- details is adapter-specific metadata.

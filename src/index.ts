export * as algebra from "./core/algebra"
export {
  and,
  or,
  not,
  term,
  relation,
  is,
  eq,
  ref,
  forAll,
  select,
  distinct,
  memo,
  evaluator,
} from "./core/algebra"
export {
  createInMemoryAdapter,
  validateStratifiedNegation,
} from "./core/algebra-inmemory"
export type {
  Environment,
  EvaluationProof,
  EvaluatorAdapter,
  EvaluatorInstance,
  Relation,
  Rule,
  Term,
  UnaryPredicate,
} from "./core/algebra"
export type {
  InMemoryAdapterOptions,
  InMemoryRelationFacts,
} from "./core/algebra-inmemory"

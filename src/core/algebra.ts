import { MaybePromise } from "./types"

export type Environment = Record<PropertyKey, unknown>

export type Term<T> = symbol & {
  readonly __termBrand?: T
}

export type UnaryPredicate<T, Env extends Environment = Environment> = (
  value: T,
  environment: Readonly<Env>,
) => MaybePromise<boolean>

type AnyTerm = Term<unknown>
type AnyUnaryPredicate = UnaryPredicate<unknown, Environment>

type TermMetadata = {
  root: AnyTerm
  predicates: Array<AnyUnaryPredicate>
}

const termMetadata = new Map<AnyTerm, TermMetadata>()

const registerBaseTerm = <T>(value: Term<T>): void => {
  termMetadata.set(value as AnyTerm, {
    root: value as AnyTerm,
    predicates: [],
  })
}

const isKnownTerm = (value: unknown): value is AnyTerm => {
  return typeof value === "symbol" && termMetadata.has(value as AnyTerm)
}

const getTermMetadata = <T>(value: Term<T>): TermMetadata => {
  const metadata = termMetadata.get(value as AnyTerm)

  if (!metadata) {
    throw new Error("unknown term used in rule expression")
  }

  return metadata
}

const normalizeTerm = <T>(
  value: Term<T>,
): { root: Term<T>; predicates: Array<UnaryPredicate<T>> } => {
  const metadata = getTermMetadata(value)

  return {
    root: metadata.root as Term<T>,
    predicates: metadata.predicates as Array<UnaryPredicate<T>>,
  }
}

const unaryNodesForTerm = <T>(value: Term<T>): Array<UnaryNode> => {
  const metadata = normalizeTerm(value)
  return metadata.predicates.map(predicate => ({
    type: "unary",
    term: metadata.root as AnyTerm,
    predicate: predicate as AnyUnaryPredicate,
  }))
}

const isRuleNode = (value: unknown): value is Rule => {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as { type?: unknown }
  return typeof candidate.type === "string"
}

const flattenByType = (
  type: "and" | "or",
  children: Array<Rule>,
): Array<Rule> => {
  return children.flatMap(child => {
    return child.type === type ? child.children : [child]
  })
}

const termToRule = (value: AnyTerm): Rule => {
  const metadata = normalizeTerm(value)
  const base: TermNode = {
    type: "term",
    term: metadata.root as AnyTerm,
  }

  const unary = unaryNodesForTerm(value)

  if (unary.length === 0) {
    return base
  }

  return {
    type: "and",
    children: [base, ...unary],
  }
}

const toRule = (value: ConstraintInput): Rule => {
  if (isRuleNode(value)) {
    return value
  }

  if (isKnownTerm(value)) {
    return termToRule(value)
  }

  throw new Error("constraint input must be a rule or known term")
}

const applyDerivedTermFilters = (
  baseNode: Rule,
  left: AnyTerm,
  right: AnyTerm,
): Rule => {
  const filters = [...unaryNodesForTerm(left), ...unaryNodesForTerm(right)]

  if (filters.length === 0) {
    return baseNode
  }

  return {
    type: "and",
    children: flattenByType("and", [baseNode, ...filters]),
  }
}

export interface Relation<Left, Right> {
  readonly kind: "relation"
  readonly id: symbol;
  (left: Term<Left>, right: Term<Right>): Rule
}

export type ConstraintInput = Rule | AnyTerm

export type Rule =
  | RelationNode
  | UnaryNode
  | TermNode
  | EqTermNode
  | EqValueNode
  | RefNode
  | AndNode
  | OrNode
  | NotNode
  | ForAllNode
  | SelectNode
  | DistinctNode
  | MemoNode

export interface RefNode {
  readonly type: "ref"
  readonly name: string
}

export interface RelationNode {
  readonly type: "relation"
  readonly relationId: symbol
  readonly left: AnyTerm
  readonly right: AnyTerm
}

export interface UnaryNode {
  readonly type: "unary"
  readonly term: AnyTerm
  readonly predicate: AnyUnaryPredicate
}

export interface TermNode {
  readonly type: "term"
  readonly term: AnyTerm
}

export interface EqTermNode {
  readonly type: "eq-term"
  readonly left: AnyTerm
  readonly right: AnyTerm
}

export interface EqValueNode {
  readonly type: "eq-value"
  readonly term: AnyTerm
  readonly value: unknown
}

export interface AndNode {
  readonly type: "and"
  readonly children: Array<Rule>
}

export interface OrNode {
  readonly type: "or"
  readonly children: Array<Rule>
}

export interface NotNode {
  readonly type: "not"
  readonly child: Rule
}

export interface ForAllNode {
  readonly type: "forall"
  readonly term: AnyTerm
  readonly child: Rule
}

export interface SelectNode {
  readonly type: "select"
  readonly terms: Array<AnyTerm>
  readonly child: Rule
}

export interface DistinctNode {
  readonly type: "distinct"
  readonly child: Rule
}

export interface MemoNode {
  readonly type: "memo"
  readonly name: string
  readonly child: Rule
}

export const term = <T>(): Term<T> => {
  const value = Symbol("abac.term") as Term<T>
  registerBaseTerm(value)
  return value
}

export const is = <T, Env extends Environment = Environment>(
  value: Term<T>,
  predicate: UnaryPredicate<T, Env>,
): Term<T> => {
  const source = normalizeTerm(value)
  const derived = Symbol("abac.term.derived") as Term<T>

  termMetadata.set(derived as AnyTerm, {
    root: source.root as AnyTerm,
    predicates: [
      ...(source.predicates as Array<AnyUnaryPredicate>),
      predicate as AnyUnaryPredicate,
    ],
  })

  return derived
}

export const relation = <Left, Right>(): Relation<Left, Right> => {
  const relationId = Symbol("abac.relation")

  const relationFn = ((left: Term<Left>, right: Term<Right>): Rule => {
    const normalizedLeft = normalizeTerm(left)
    const normalizedRight = normalizeTerm(right)

    const base: RelationNode = {
      type: "relation",
      relationId,
      left: normalizedLeft.root as AnyTerm,
      right: normalizedRight.root as AnyTerm,
    }

    return applyDerivedTermFilters(base, left as AnyTerm, right as AnyTerm)
  }) as Relation<Left, Right>

  Object.defineProperty(relationFn, "kind", {
    value: "relation",
    enumerable: true,
  })

  Object.defineProperty(relationFn, "id", {
    value: relationId,
    enumerable: true,
  })

  return relationFn
}

export const eq = <T>(left: Term<T>, right: Term<T> | T): Rule => {
  const normalizedLeft = normalizeTerm(left)
  const leftFilters = unaryNodesForTerm(left as AnyTerm)

  if (isKnownTerm(right)) {
    const normalizedRight = normalizeTerm(right as Term<T>)
    const rightFilters = unaryNodesForTerm(right as AnyTerm)
    const base: EqTermNode = {
      type: "eq-term",
      left: normalizedLeft.root as AnyTerm,
      right: normalizedRight.root as AnyTerm,
    }

    return {
      type: "and",
      children: flattenByType("and", [base, ...leftFilters, ...rightFilters]),
    }
  }

  const base: EqValueNode = {
    type: "eq-value",
    term: normalizedLeft.root as AnyTerm,
    value: right,
  }

  if (leftFilters.length === 0) {
    return base
  }

  return {
    type: "and",
    children: flattenByType("and", [base, ...leftFilters]),
  }
}

export const ref = (name: string): Rule => {
  if (name.trim().length === 0) {
    throw new Error("ref name is required")
  }

  return {
    type: "ref",
    name,
  }
}

export const and = (...constraints: Array<ConstraintInput>): Rule => {
  return {
    type: "and",
    children: flattenByType("and", constraints.map(toRule)),
  }
}

export const or = (...constraints: Array<ConstraintInput>): Rule => {
  return {
    type: "or",
    children: flattenByType("or", constraints.map(toRule)),
  }
}

export const not = (constraint: ConstraintInput): Rule => {
  return {
    type: "not",
    child: toRule(constraint),
  }
}

export const forAll = <T>(
  value: Term<T>,
  constraint: ConstraintInput,
): Rule => {
  const normalized = normalizeTerm(value)

  return {
    type: "forall",
    term: normalized.root as AnyTerm,
    child: toRule(constraint),
  }
}

export const select = (...terms: Array<AnyTerm>) => {
  return (constraint: ConstraintInput): Rule => {
    return {
      type: "select",
      terms: terms.map(value => normalizeTerm(value).root as AnyTerm),
      child: toRule(constraint),
    }
  }
}

export const distinct = (constraint: ConstraintInput): Rule => {
  return {
    type: "distinct",
    child: toRule(constraint),
  }
}

export const memo = (name: string, constraint: ConstraintInput): Rule => {
  if (name.trim().length === 0) {
    throw new Error("memo name is required")
  }

  return {
    type: "memo",
    name,
    child: toRule(constraint),
  }
}

export interface EvaluationProof {
  readonly ok: boolean
  readonly rule: Rule
  readonly details?: Record<string, unknown>
}

export interface EvaluatorAdapter<Env extends Environment, EvaluatorContext> {
  evaluate(
    rule: Rule,
    environment: Readonly<Env>,
    evaluatorContext: EvaluatorContext,
  ): MaybePromise<boolean>
  evaluateWithProof?: (
    rule: Rule,
    environment: Readonly<Env>,
    evaluatorContext: EvaluatorContext,
  ) => MaybePromise<EvaluationProof>
}

export interface EvaluatorInstance<Env extends Environment> {
  evaluate(rule: Rule, environment: Readonly<Env>): Promise<boolean>
  evaluateWithProof(
    rule: Rule,
    environment: Readonly<Env>,
  ): Promise<EvaluationProof>
}

export const evaluator = <Env extends Environment, EvaluatorContext>(
  adapter: EvaluatorAdapter<Env, EvaluatorContext>,
  options: { evaluatorContext: EvaluatorContext },
): EvaluatorInstance<Env> => {
  return {
    evaluate(rule, environment) {
      return Promise.resolve(
        adapter.evaluate(rule, environment, options.evaluatorContext),
      )
    },
    async evaluateWithProof(rule, environment) {
      if (adapter.evaluateWithProof) {
        return adapter.evaluateWithProof(
          rule,
          environment,
          options.evaluatorContext,
        )
      }

      const ok = await adapter.evaluate(
        rule,
        environment,
        options.evaluatorContext,
      )
      return { ok, rule }
    },
  }
}

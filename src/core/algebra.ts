import { MaybePromise } from "./types"

export type Environment = Record<PropertyKey, unknown>

export type Term<T> = symbol & {
  readonly __termBrand?: T
  is<Env extends Environment = Environment>(
    predicate: UnaryPredicate<T, Env>,
  ): Term<T>
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

const createDerivedTerm = <T, Env extends Environment = Environment>(
  value: Term<T>,
  predicate: UnaryPredicate<T, Env>,
): Term<T> => {
  const source = normalizeTerm(value)
  const derived = Symbol("rules.term.derived") as Term<T>

  termMetadata.set(derived as AnyTerm, {
    root: source.root as AnyTerm,
    predicates: [
      ...(source.predicates as Array<AnyUnaryPredicate>),
      predicate as AnyUnaryPredicate,
    ],
  })

  return derived
}

const termIs = function <T, Env extends Environment = Environment>(
  this: symbol,
  predicate: UnaryPredicate<T, Env>,
): Term<T> {
  if (!isKnownTerm(this)) {
    throw new Error("unknown term used in rule expression")
  }

  return createDerivedTerm(this as Term<T>, predicate)
}

const installTermIsMethod = (): void => {
  const symbolPrototype = Symbol.prototype as symbol & {
    is?: unknown
  }

  if (symbolPrototype.is === undefined) {
    Object.defineProperty(symbolPrototype, "is", {
      value: termIs,
      enumerable: false,
      configurable: true,
      writable: true,
    })

    return
  }

  if (symbolPrototype.is !== termIs) {
    throw new Error("Symbol.prototype.is is already defined")
  }
}

installTermIsMethod()

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

export type RuleReferenceToken = symbol & {
  readonly __ruleReferenceBrand?: true
}

export type OutcomeToken = symbol & {
  readonly __outcomeTokenBrand?: true
}

export interface RuleAnnotations {
  readonly label?: string
  readonly referenceToken?: RuleReferenceToken
  readonly outcomeToken?: OutcomeToken
}

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
  | DerivesNode
  | GivenNode

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

export interface DerivesNode {
  readonly type: "derives"
  readonly entity: AnyTerm
  readonly from: AnyTerm
}

export interface GivenNode {
  readonly type: "given"
  readonly rule: Rule
  readonly context: Rule
}

const ruleAnnotations = new WeakMap<Rule, RuleAnnotations>()

export const annotateRule = <TRule extends Rule>(
  rule: TRule,
  annotations: RuleAnnotations,
): TRule => {
  const existing = ruleAnnotations.get(rule)
  ruleAnnotations.set(rule, {
    ...(existing ?? {}),
    ...annotations,
  })
  return rule
}

export const getRuleAnnotations = (rule: Rule): RuleAnnotations | undefined => {
  return ruleAnnotations.get(rule)
}

export const sortRulesByPriorityAndKind = <
  TRule extends { kind: string; priority: number },
>(
  rules: ReadonlyArray<TRule>,
  kindOrder: ReadonlyArray<TRule["kind"]>,
): TRule[] => {
  const kindPriority = new Map(
    kindOrder.map((kind, index) => [kind, index] as const),
  )

  return [...rules].sort((left, right) => {
    const priorityDiff = right.priority - left.priority
    if (priorityDiff !== 0) {
      return priorityDiff
    }

    const leftKind = kindPriority.get(left.kind) ?? Number.MAX_SAFE_INTEGER
    const rightKind = kindPriority.get(right.kind) ?? Number.MAX_SAFE_INTEGER
    return leftKind - rightKind
  })
}

export interface TermInfo<T> {
  readonly root: Term<T>
  readonly predicates: Array<UnaryPredicate<T>>
  readonly predicateCount: number
}

export const getTermInfo = <T>(value: Term<T>): TermInfo<T> => {
  const normalized = normalizeTerm(value)
  return {
    root: normalized.root,
    predicates: normalized.predicates,
    predicateCount: normalized.predicates.length,
  }
}

export const term = <T>(): Term<T> => {
  const value = Symbol("rules.term") as Term<T>
  registerBaseTerm(value)
  return value
}

export const relation = <Left, Right>(): Relation<Left, Right> => {
  const relationId = Symbol("rules.relation")

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

export const withExclusions = (
  exclusions: Array<ConstraintInput>,
  candidates: Array<ConstraintInput>,
): Rule => {
  const candidateRule = candidates.length === 0 ? or() : or(...candidates)

  if (exclusions.length === 0) {
    return candidateRule
  }

  return and(not(or(...exclusions)), candidateRule)
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

export const implies = (
  premise: ConstraintInput,
  consequence: ConstraintInput,
): Rule => {
  return {
    type: "or",
    children: flattenByType("or", [
      {
        type: "not",
        child: toRule(premise),
      },
      toRule(consequence),
    ]),
  }
}

const combinations = <T>(
  values: ReadonlyArray<T>,
  size: number,
): Array<Array<T>> => {
  if (size === 0) {
    return [[]]
  }

  if (size > values.length) {
    return []
  }

  return values.flatMap((value, index) => {
    return combinations(values.slice(index + 1), size - 1).map(rest => {
      return [value, ...rest]
    })
  })
}

const normalizeCount = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} requires a non-negative integer count`)
  }

  return value
}

export const oneOf = <T>(value: Term<T>, values: ReadonlyArray<T>): Rule => {
  return or(...values.map(option => eq(value, option)))
}

export const atLeast = (
  count: number,
  ...constraints: Array<ConstraintInput>
): Rule => {
  const normalizedCount = normalizeCount(count, "atLeast")
  const rules = constraints.map(toRule)

  if (normalizedCount === 0) {
    return and()
  }

  if (normalizedCount > rules.length) {
    return or()
  }

  return or(
    ...combinations(rules, normalizedCount).map(group => {
      return and(...group)
    }),
  )
}

export const atMost = (
  count: number,
  ...constraints: Array<ConstraintInput>
): Rule => {
  const normalizedCount = normalizeCount(count, "atMost")
  const rules = constraints.map(toRule)

  if (normalizedCount >= rules.length) {
    return and()
  }

  if (normalizedCount === 0) {
    return and(...rules.map(rule => not(rule)))
  }

  return and(
    ...combinations(rules, normalizedCount + 1).map(group => {
      return not(and(...group))
    }),
  )
}

export const exactly = (
  count: number,
  ...constraints: Array<ConstraintInput>
): Rule => {
  const normalizedCount = normalizeCount(count, "exactly")

  return and(
    atLeast(normalizedCount, ...constraints),
    atMost(normalizedCount, ...constraints),
  )
}

export const through = <Left>(term: Term<Left>) => {
  type Builder = Rule & {
    to: <Right>(relation: Relation<Left, Right>, right: Term<Right>) => Builder
  }

  const create = (children: Rule[]): Builder => {
    const builder: Builder = Object.assign(
      {
        type: "and",
        children,
      } as unknown as Rule,
      {
        to: <Right>(relation: Relation<Left, Right>, right: Term<Right>) =>
          create([...children, relation(term, right)]),
      },
    ) as Builder

    return builder
  }

  return create([])
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

export const letRule = (name: string, constraint: ConstraintInput): Rule => {
  if (name.trim().length === 0) {
    throw new Error("letRule name is required")
  }

  return {
    type: "memo",
    name,
    child: toRule(constraint),
  }
}

export const derives = <T>(entity: Term<T>, from: Term<T>): Rule => {
  const normalizedEntity = normalizeTerm(entity)
  const normalizedFrom = normalizeTerm(from)

  return {
    type: "derives",
    entity: normalizedEntity.root as AnyTerm,
    from: normalizedFrom.root as AnyTerm,
  }
}

export const given = (
  rule: ConstraintInput,
  context: ConstraintInput,
): Rule => {
  return {
    type: "given",
    rule: toRule(rule),
    context: toRule(context),
  }
}

export interface EvaluationProof {
  readonly ok: boolean
  readonly rule: Rule
  readonly details?: EvaluationProofDetails
}

export interface RuleBranchOutcome {
  readonly referenceToken?: RuleReferenceToken
  readonly matched: boolean
  readonly label?: string
}

export interface EvaluationProofDetails {
  readonly branchOutcomes?: Array<RuleBranchOutcome>
  readonly matchedReferenceTokens?: Array<RuleReferenceToken>
  readonly diagnostics?: ReadonlyArray<unknown>
  readonly [key: string]: unknown
}

export const buildEvaluationProofDetails = (
  rule: Rule,
  matched: boolean,
): EvaluationProofDetails => {
  const annotations = getRuleAnnotations(rule)

  if (!annotations) {
    return {
      branchOutcomes: [
        {
          matched,
        },
      ],
    }
  }

  return {
    branchOutcomes: [
      {
        matched,
        label: annotations.label,
        referenceToken: annotations.referenceToken,
      },
    ],
    matchedReferenceTokens:
      matched && annotations.referenceToken ? [annotations.referenceToken] : [],
  }
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
      return {
        ok,
        rule,
        details: buildEvaluationProofDetails(rule, ok),
      }
    },
  }
}

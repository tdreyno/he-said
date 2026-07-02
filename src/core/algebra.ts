import { MaybePromise } from "./types"

export type Environment = Record<PropertyKey, unknown>

export type Term<T> = symbol & {
  readonly __termBrand?: T
  is<Env extends Environment = Environment>(
    predicate: TermPredicate<T, Env>,
  ): Term<T>
}

export type Fact<T> = symbol & {
  readonly __factBrand?: T
}

export type UnaryPredicate<T, Env extends Environment = Environment> = (
  value: T,
  environment: Readonly<Env>,
) => MaybePromise<boolean>

export type SourceComparisonOperator = "eq" | "gt" | "ge" | "lt" | "le"

export type SourcePredicate =
  | {
      column: string
      op: "in"
      values: ReadonlyArray<unknown>
    }
  | {
      column: string
      op: SourceComparisonOperator
      value: unknown
    }

export type SourceOrdering = {
  column: string
  order: Readonly<Record<string, number>>
}

type AnyTerm = Term<unknown>
type AnyAttributeAccessor = AttributeAccessor<any, unknown>

export interface AttributeAccessor<T, TValue> {
  readonly kind: "attribute-accessor"
  readonly term: Term<T>
  readonly column: string
  readonly __valueBrand?: TValue
}

export type PredicateOperand<TValue = unknown> =
  | Term<TValue>
  | AttributeAccessor<any, TValue>

type AnyPredicateOperand = PredicateOperand<unknown>

export interface EqPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "eq"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface NePredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "ne"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface GtPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "gt"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface GePredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "ge"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface LtPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "lt"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface LePredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "le"
  readonly left: AnyPredicateOperand
  readonly right: AnyPredicateOperand | unknown
}

export interface OneOfPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "one-of"
  readonly left: AnyPredicateOperand
  readonly values: ReadonlyArray<unknown>
}

export interface IsNullPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "is-null"
  readonly operand: AnyPredicateOperand
}

export interface IsNotNullPredicateExpression {
  readonly kind: "predicate-expression"
  readonly operator: "is-not-null"
  readonly operand: AnyPredicateOperand
}

export type PredicateExpression =
  | EqPredicateExpression
  | NePredicateExpression
  | GtPredicateExpression
  | GePredicateExpression
  | LtPredicateExpression
  | LePredicateExpression
  | OneOfPredicateExpression
  | IsNullPredicateExpression
  | IsNotNullPredicateExpression

export type TermPredicate<T, Env extends Environment = Environment> =
  | UnaryPredicate<T, Env>
  | PredicateExpression

type AnyTermPredicate = TermPredicate<unknown, Environment>

type TermMetadata = {
  root: AnyTerm
  predicates: Array<AnyTermPredicate>
}

const termMetadata = new Map<AnyTerm, TermMetadata>()

const createDerivedTerm = <T, Env extends Environment = Environment>(
  value: Term<T>,
  predicate: TermPredicate<T, Env>,
): Term<T> => {
  const source = normalizeTerm(value)
  const derived = Symbol("rules.term.derived") as Term<T>

  termMetadata.set(derived as AnyTerm, {
    root: source.root as AnyTerm,
    predicates: [
      ...(source.predicates as Array<AnyTermPredicate>),
      predicate as AnyTermPredicate,
    ],
  })

  return derived
}

const termIs = function <T, Env extends Environment = Environment>(
  this: symbol,
  predicate: TermPredicate<T, Env>,
): Term<T> {
  if (!isKnownTerm(this)) {
    throw new Error("unknown term used in rule expression")
  }

  const normalized = normalizePredicate(predicate as AnyTermPredicate)
  const root = normalizeTerm(this as Term<T>).root as AnyTerm
  if (
    isPredicateExpression(normalized) &&
    !getPredicateExpressionTerms(normalized).includes(root)
  ) {
    throw new Error(
      "predicate expression must reference the term it is attached to via term.is(...)",
    )
  }

  return createDerivedTerm(this as Term<T>, normalized as TermPredicate<T, Env>)
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
): { root: Term<T>; predicates: Array<TermPredicate<T>> } => {
  const metadata = getTermMetadata(value)

  return {
    root: metadata.root as Term<T>,
    predicates: metadata.predicates as Array<TermPredicate<T>>,
  }
}

const unaryNodesForTerm = <T>(value: Term<T>): Array<UnaryNode> => {
  const metadata = normalizeTerm(value)
  return metadata.predicates.map(predicate => ({
    type: "unary",
    term: metadata.root as AnyTerm,
    predicate: predicate as AnyTermPredicate,
  }))
}

const normalizeOperand = (value: AnyPredicateOperand): AnyPredicateOperand => {
  if (isKnownTerm(value)) {
    return normalizeTerm(value as Term<unknown>).root
  }

  return {
    ...value,
    term: normalizeTerm(value.term as Term<unknown>).root,
  } as AttributeAccessor<any, unknown>
}

const normalizeOperandOrValue = (
  value: AnyPredicateOperand | unknown,
): AnyPredicateOperand | unknown => {
  if (isKnownTerm(value) || isAttributeAccessor(value)) {
    return normalizeOperand(value as AnyPredicateOperand)
  }

  return value
}

const normalizePredicate = (predicate: AnyTermPredicate): AnyTermPredicate => {
  if (!isPredicateExpression(predicate)) {
    return predicate
  }

  switch (predicate.operator) {
    case "eq":
    case "ne":
    case "gt":
    case "ge":
    case "lt":
    case "le":
      return {
        ...predicate,
        left: normalizeOperand(predicate.left),
        right: normalizeOperandOrValue(predicate.right),
      }
    case "one-of":
      return {
        ...predicate,
        left: normalizeOperand(predicate.left),
      }
    case "is-null":
    case "is-not-null":
      return {
        ...predicate,
        operand: normalizeOperand(predicate.operand),
      }
    default: {
      const exhaustive: never = predicate
      return exhaustive
    }
  }
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
  readonly id: symbol
  readonly pairs?: ReadonlyArray<readonly [Left, Right]>;
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
  readonly predicate: AnyTermPredicate
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
  readonly predicates: Array<TermPredicate<T>>
  readonly predicateCount: number
}

type SymbolOptions = {
  label?: string
}

const normalizeSymbolLabel = (
  options?: string | SymbolOptions,
): string | undefined => {
  if (options === undefined) {
    return undefined
  }

  const label = typeof options === "string" ? options : options.label

  if (label === undefined) {
    return undefined
  }

  const normalized = label.trim()
  if (normalized.length === 0) {
    throw new Error("symbol label must not be empty")
  }

  return normalized
}

const createBaseTerm = <T>(
  kind: "term" | "fact",
  options?: string | SymbolOptions,
): Term<T> => {
  const label = normalizeSymbolLabel(options)
  const symbolLabel = label ? `rules.${kind}.${label}` : `rules.${kind}`
  const value = Symbol(symbolLabel) as Term<T>
  registerBaseTerm(value)
  return value
}

export const isAttributeAccessor = (
  value: unknown,
): value is AnyAttributeAccessor => {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as {
    kind?: unknown
    term?: unknown
    column?: unknown
  }
  return (
    candidate.kind === "attribute-accessor" &&
    typeof candidate.column === "string" &&
    isKnownTerm(candidate.term)
  )
}

export const isPredicateExpression = (
  value: unknown,
): value is PredicateExpression => {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as { kind?: unknown; operator?: unknown }
  if (candidate.kind !== "predicate-expression") {
    return false
  }

  return (
    candidate.operator === "eq" ||
    candidate.operator === "ne" ||
    candidate.operator === "gt" ||
    candidate.operator === "ge" ||
    candidate.operator === "lt" ||
    candidate.operator === "le" ||
    candidate.operator === "one-of" ||
    candidate.operator === "is-null" ||
    candidate.operator === "is-not-null"
  )
}

export const getPredicateExpressionTerms = (
  expression: PredicateExpression,
): Array<AnyTerm> => {
  const terms = new Set<AnyTerm>()
  const addOperand = (operand: AnyPredicateOperand): void => {
    if (isKnownTerm(operand)) {
      terms.add(normalizeTerm(operand as Term<unknown>).root as AnyTerm)
      return
    }

    terms.add(normalizeTerm(operand.term as Term<unknown>).root as AnyTerm)
  }

  switch (expression.operator) {
    case "eq":
    case "ne":
    case "gt":
    case "ge":
    case "lt":
    case "le":
      addOperand(expression.left)
      if (
        isKnownTerm(expression.right) ||
        isAttributeAccessor(expression.right)
      ) {
        addOperand(expression.right as AnyPredicateOperand)
      }
      break
    case "one-of":
      addOperand(expression.left)
      break
    case "is-null":
    case "is-not-null":
      addOperand(expression.operand)
      break
    default: {
      const exhaustive: never = expression
      return exhaustive
    }
  }

  return [...terms]
}

export const getTermInfo = <T>(value: Term<T>): TermInfo<T> => {
  const normalized = normalizeTerm(value)
  return {
    root: normalized.root,
    predicates: normalized.predicates,
    predicateCount: normalized.predicates.length,
  }
}

export const term = <T>(options?: string | SymbolOptions): Term<T> => {
  return createBaseTerm("term", options)
}

export const fact = <T>(options?: string | SymbolOptions): Fact<T> => {
  return createBaseTerm("fact", options) as unknown as Fact<T>
}

export const factIsTrue = (value: Fact<boolean>): Rule => {
  return eq(value as unknown as Term<boolean>, true)
}

export const attr = <T, K extends keyof T & string>(
  target: Term<T>,
  column: K,
): AttributeAccessor<T, T[K]> => {
  if (column.trim().length === 0) {
    throw new Error("attr column is required")
  }

  return {
    kind: "attribute-accessor",
    term: normalizeTerm(target).root,
    column,
  }
}

export const relation = <Left, Right>(
  pairs?: ReadonlyArray<readonly [Left, Right]>,
): Relation<Left, Right> => {
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

  if (pairs !== undefined) {
    Object.defineProperty(relationFn, "pairs", {
      value: pairs,
      enumerable: true,
    })
  }

  return relationFn
}

export function eq<T>(left: Term<T>, right: Term<T> | T): Rule
export function eq<T>(
  left: AttributeAccessor<any, T>,
  right: AttributeAccessor<any, T> | T,
): PredicateExpression
export function eq<T>(
  left: Term<T> | AttributeAccessor<any, T>,
  right: Term<T> | AttributeAccessor<any, T> | T,
): Rule | PredicateExpression {
  if (isAttributeAccessor(left)) {
    return {
      kind: "predicate-expression",
      operator: "eq",
      left: normalizeOperand(left),
      right: normalizeOperandOrValue(right),
    }
  }

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

const createBinaryExpression = (
  operator: "ne" | "gt" | "ge" | "lt" | "le",
  left: AnyPredicateOperand,
  right: AnyPredicateOperand | unknown,
): PredicateExpression => {
  return {
    kind: "predicate-expression",
    operator,
    left: normalizeOperand(left),
    right: normalizeOperandOrValue(right),
  }
}

export const ne = <T>(
  left: PredicateOperand<T>,
  right: PredicateOperand<T> | T,
): PredicateExpression => createBinaryExpression("ne", left, right)

export const gt = <T>(
  left: PredicateOperand<T>,
  right: PredicateOperand<T> | T,
): PredicateExpression => createBinaryExpression("gt", left, right)

export const ge = <T>(
  left: PredicateOperand<T>,
  right: PredicateOperand<T> | T,
): PredicateExpression => createBinaryExpression("ge", left, right)

export const lt = <T>(
  left: PredicateOperand<T>,
  right: PredicateOperand<T> | T,
): PredicateExpression => createBinaryExpression("lt", left, right)

export const le = <T>(
  left: PredicateOperand<T>,
  right: PredicateOperand<T> | T,
): PredicateExpression => createBinaryExpression("le", left, right)

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

export function oneOf<T>(value: Term<T>, values: ReadonlyArray<T>): Rule
export function oneOf<T>(
  value: AttributeAccessor<any, T>,
  values: ReadonlyArray<T>,
): PredicateExpression
export function oneOf<T>(
  value: Term<T> | AttributeAccessor<any, T>,
  values: ReadonlyArray<T>,
): Rule | PredicateExpression {
  if (isAttributeAccessor(value)) {
    return {
      kind: "predicate-expression",
      operator: "one-of",
      left: normalizeOperand(value),
      values,
    }
  }

  return or(...values.map(option => eq(value, option)))
}

export const isNull = <T>(
  operand: PredicateOperand<T>,
): PredicateExpression => {
  return {
    kind: "predicate-expression",
    operator: "is-null",
    operand: normalizeOperand(operand),
  }
}

export const isNotNull = <T>(
  operand: PredicateOperand<T>,
): PredicateExpression => {
  return {
    kind: "predicate-expression",
    operator: "is-not-null",
    operand: normalizeOperand(operand),
  }
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
  readonly failing?: EvaluationFailingNode
  readonly details?: EvaluationProofDetails
}

export type EvaluationFailingNodeKind =
  | "relation"
  | "eq-term"
  | "eq-value"
  | "derives"
  | "not"
  | "forall"
  | "or"
  | "given-context"
  | "ref"
  | "term"
  | "unary"
  | "unknown"

export interface EvaluationFailingNode {
  readonly kind: EvaluationFailingNodeKind
  readonly path: string
  readonly reason: string
  readonly relationId?: symbol
  readonly sql?: string
  readonly paramCount?: number
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
  prepare?: (
    options: EvaluatorPrepareOptions<Env>,
    evaluatorContext: EvaluatorContext,
  ) => MaybePromise<PreparedEvaluatorAdapter<Env>>
  filter?: <T>(
    rule: Rule,
    options: FilterOptions<Env, T>,
    evaluatorContext: EvaluatorContext,
  ) => MaybePromise<ReadonlyArray<T>>
}

export interface EvaluatorPrepareOptions<Env extends Environment> {
  readonly environment?: Readonly<Env>
  readonly preload?: ReadonlyArray<Relation<any, any>>
  readonly facts?: Readonly<Environment>
}

export interface PreparedEvaluatorAdapter<Env extends Environment> {
  evaluate(rule: Rule, environment: Readonly<Env>): MaybePromise<boolean>
  evaluateWithProof?: (
    rule: Rule,
    environment: Readonly<Env>,
  ) => MaybePromise<EvaluationProof>
}

export interface PreparedEvaluatorInstance<Env extends Environment> {
  evaluate(rule: Rule, environment?: Readonly<Env>): Promise<boolean>
  evaluateWithProof(
    rule: Rule,
    environment?: Readonly<Env>,
  ): Promise<EvaluationProof>
}

export interface FilterOptions<Env extends Environment, T> {
  readonly environment: Readonly<Env>
  readonly term: Term<T>
  readonly candidates?: ReadonlyArray<T>
}

export type EvaluationInput<Env extends Environment = Environment> = Env & {
  readonly facts?: Readonly<Record<PropertyKey, unknown>>
}

const normalizeEvaluationInput = <Env extends Environment>(
  input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
): Readonly<Env> => {
  if (!Object.prototype.hasOwnProperty.call(input, "facts")) {
    return input as Readonly<Env>
  }

  const candidate = input as Readonly<EvaluationInput<Env>>
  if (candidate.facts === undefined) {
    return input as Readonly<Env>
  }

  if (typeof candidate.facts !== "object" || candidate.facts === null) {
    throw new Error("evaluation facts must be an object when provided")
  }

  const environment: Environment = {}
  Reflect.ownKeys(input).forEach(key => {
    if (key !== "facts") {
      environment[key] = input[key as keyof typeof input]
    }
  })

  Reflect.ownKeys(candidate.facts).forEach(key => {
    environment[key] = candidate.facts?.[key as keyof typeof candidate.facts]
  })

  return environment as Readonly<Env>
}

export interface EvaluatorInstance<Env extends Environment> {
  evaluate(
    rule: Rule,
    input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
  ): Promise<boolean>
  evaluateWithProof(
    rule: Rule,
    input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
  ): Promise<EvaluationProof>
  filter<T>(
    rule: Rule,
    options: FilterOptions<Env, T>,
  ): Promise<ReadonlyArray<T>>
  prepare(
    options: EvaluatorPrepareOptions<Env>,
  ): Promise<PreparedEvaluatorInstance<Env>>
}

export const evaluator = <Env extends Environment, EvaluatorContext>(
  adapter: EvaluatorAdapter<Env, EvaluatorContext>,
  config: { evaluatorContext: EvaluatorContext },
): EvaluatorInstance<Env> => {
  const combineEnvironments = (
    baseEnvironment: Readonly<Env> | undefined,
    factEnvironment: Readonly<Environment> | undefined,
    environment: Readonly<Env> | undefined,
  ): Readonly<Env> => {
    return {
      ...(baseEnvironment ?? {}),
      ...(factEnvironment ?? {}),
      ...(environment ?? {}),
    } as Readonly<Env>
  }

  return {
    evaluate(rule, input) {
      const environment = normalizeEvaluationInput(input)
      return Promise.resolve(
        adapter.evaluate(rule, environment, config.evaluatorContext),
      )
    },
    async evaluateWithProof(rule, input) {
      const environment = normalizeEvaluationInput(input)
      if (adapter.evaluateWithProof) {
        return adapter.evaluateWithProof(
          rule,
          environment,
          config.evaluatorContext,
        )
      }

      const ok = await adapter.evaluate(
        rule,
        environment,
        config.evaluatorContext,
      )
      return {
        ok,
        rule,
        details: buildEvaluationProofDetails(rule, ok),
      }
    },
    async prepare(prepareOptions) {
      const baseEnvironment = prepareOptions.environment
      const factEnvironment = prepareOptions.facts
      const mergeWithPrepared = (
        environment?: Readonly<Env>,
      ): Readonly<Env> => {
        return combineEnvironments(
          baseEnvironment,
          factEnvironment,
          environment,
        )
      }

      if (adapter.prepare) {
        const preparedAdapter = await adapter.prepare(
          prepareOptions,
          config.evaluatorContext,
        )
        return {
          evaluate(rule, environment) {
            return Promise.resolve(
              preparedAdapter.evaluate(rule, mergeWithPrepared(environment)),
            )
          },
          async evaluateWithProof(rule, environment) {
            if (preparedAdapter.evaluateWithProof) {
              return preparedAdapter.evaluateWithProof(
                rule,
                mergeWithPrepared(environment),
              )
            }

            const ok = await preparedAdapter.evaluate(
              rule,
              mergeWithPrepared(environment),
            )
            return {
              ok,
              rule,
              details: buildEvaluationProofDetails(rule, ok),
            }
          },
        }
      }

      return {
        evaluate(rule, environment) {
          return Promise.resolve(
            adapter.evaluate(
              rule,
              mergeWithPrepared(environment),
              config.evaluatorContext,
            ),
          )
        },
        async evaluateWithProof(rule, environment) {
          if (adapter.evaluateWithProof) {
            return adapter.evaluateWithProof(
              rule,
              mergeWithPrepared(environment),
              config.evaluatorContext,
            )
          }

          const ok = await adapter.evaluate(
            rule,
            mergeWithPrepared(environment),
            config.evaluatorContext,
          )
          return {
            ok,
            rule,
            details: buildEvaluationProofDetails(rule, ok),
          }
        },
      }
    },
    async filter(rule, options) {
      if (!adapter.filter) {
        throw new Error("adapter does not support filter evaluation")
      }

      return adapter.filter(rule, options, config.evaluatorContext)
    },
  }
}

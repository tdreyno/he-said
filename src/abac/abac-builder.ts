import {
  eq as algebraEq,
  ge as algebraGe,
  type AttributeAccessor,
  and,
  annotateRule,
  getPredicateExpressionTerms,
  isAttributeAccessor,
  isPredicateExpression,
  type PredicateExpression,
  type Rule,
  type RuleAnnotations,
  type Term,
  term,
} from "../core/algebra"
import type {
  ActionToken,
  FailureToken,
  PolicyRef,
  RuleKind,
  RuleOptions,
  RuleRef,
  RuleReferenceToken,
} from "./abac-types"

export interface EvalContext<User, Resource, Environment> {
  readonly action: ActionToken
  readonly user: User
  readonly resource: Resource
  readonly environment: Environment
}

const ACTION_LABELS = new Map<ActionToken, string | undefined>()
const FAILURE_MESSAGES = new Map<FailureToken, string | undefined>()

const EVAL_CONTEXT_TERM = term<EvalContext<unknown, unknown, unknown>>()
const ACTION_TERM = term<ActionToken>()
const USER_TERM = term<unknown>()
const RESOURCE_TERM = term<unknown>()
const ENVIRONMENT_TERM = term<unknown>()

type RuleDefinition = Rule | PredicateExpression
type RuleInput = RuleDefinition | readonly RuleDefinition[]

type ABACContextTerm =
  | typeof EVAL_CONTEXT_TERM
  | typeof ACTION_TERM
  | typeof USER_TERM
  | typeof RESOURCE_TERM
  | typeof ENVIRONMENT_TERM

const isABACContextTerm = (value: symbol): value is ABACContextTerm => {
  return (
    value === EVAL_CONTEXT_TERM ||
    value === ACTION_TERM ||
    value === USER_TERM ||
    value === RESOURCE_TERM ||
    value === ENVIRONMENT_TERM
  )
}

const predicateExpressionToRule = (expression: PredicateExpression): Rule => {
  const terms = getPredicateExpressionTerms(expression)
  const anchor = terms[0]

  if (!anchor) {
    throw new Error(
      "abac predicate expression must reference at least one known term",
    )
  }

  return and(anchor.is(expression))
}

const normalizeRuleDefinition = (definition: RuleDefinition): Rule => {
  if (isPredicateExpression(definition)) {
    return predicateExpressionToRule(definition)
  }

  return definition
}

const normalizeRuleInput = (input: RuleInput): Rule => {
  if (Array.isArray(input)) {
    return and(...input.map(normalizeRuleDefinition))
  }

  return normalizeRuleDefinition(input as RuleDefinition)
}

const contextTerm = <User, Resource, Environment>(): Term<
  EvalContext<User, Resource, Environment>
> => {
  return EVAL_CONTEXT_TERM as Term<EvalContext<User, Resource, Environment>>
}

export const actionTerm = (): Term<ActionToken> => ACTION_TERM
export const userTerm = <User>(): Term<User> => USER_TERM as Term<User>
export const resourceTerm = <Resource>(): Term<Resource> =>
  RESOURCE_TERM as Term<Resource>
export const environmentTerm = <Environment>(): Term<Environment> =>
  ENVIRONMENT_TERM as Term<Environment>

const ruleFromPredicate = <User, Resource, Environment>(
  predicate: (ctx: EvalContext<User, Resource, Environment>) => boolean,
): Rule => {
  return and(contextTerm<User, Resource, Environment>().is(predicate))
}

const buildRuleRef = (
  kind: RuleKind,
  definition: RuleInput,
  options?: RuleOptions,
): RuleRef => {
  const compiledRule = normalizeRuleInput(definition)
  const reference = Symbol("abac.rule.ref") as RuleReferenceToken

  const annotations: RuleAnnotations = {
    label: options?.name,
    referenceToken: reference,
    outcomeToken: options?.failure,
  }

  annotateRule(compiledRule, annotations)

  return {
    kind,
    ref: reference,
    rule: compiledRule,
    name: options?.name,
    failure: options?.failure,
    priority: options?.priority ?? 0,
  }
}

export const action = <TLabel extends string = string>(
  label?: TLabel,
): ActionToken<TLabel> => {
  const value = Symbol(label ?? "abac.action") as ActionToken<TLabel>
  ACTION_LABELS.set(value as ActionToken, label)
  return value
}

export const actionLabel = (value: ActionToken): string | undefined => {
  return ACTION_LABELS.get(value)
}

export const failure = (message?: string): FailureToken => {
  const value = Symbol("abac.failure") as FailureToken
  FAILURE_MESSAGES.set(value, message)
  return value
}

export const failureMessage = (token: FailureToken): string | undefined => {
  return FAILURE_MESSAGES.get(token)
}

export const actionIs = (target: ActionToken): Rule => {
  return ruleFromPredicate<unknown, unknown, unknown>(ctx => {
    return ctx.action === target
  })
}

export const actionIn = (...targets: ActionToken[]): Rule => {
  const set = new Set(targets)
  return ruleFromPredicate<unknown, unknown, unknown>(ctx => {
    return set.has(ctx.action)
  })
}

export function eq<User, T>(left: (user: User) => T, right: T): Rule
export function eq<User, Resource, T>(
  left: (user: User) => T,
  right: (resource: Resource) => T,
): Rule
export function eq<T>(
  left: AttributeAccessor<any, T>,
  right: AttributeAccessor<any, T> | T,
): PredicateExpression
export function eq<User, Resource, T>(
  left: ((user: User) => T) | AttributeAccessor<any, T>,
  right: ((resource: Resource) => T) | AttributeAccessor<any, T> | T,
): Rule | PredicateExpression {
  if (isAttributeAccessor(left)) {
    return algebraEq(left, right as AttributeAccessor<any, T> | T)
  }

  return ruleFromPredicate<User, Resource, unknown>(ctx => {
    const rightValue =
      typeof right === "function"
        ? (right as (resource: Resource) => T)(ctx.resource)
        : right

    return Object.is(left(ctx.user), rightValue)
  })
}

export function ge<User>(left: (user: User) => number, right: number): Rule
export function ge<User, Resource>(
  left: (user: User) => number,
  right: (resource: Resource) => number,
): Rule
export function ge<T>(
  left: AttributeAccessor<any, T>,
  right: AttributeAccessor<any, T> | T,
): PredicateExpression
export function ge<User, Resource, T>(
  left: ((user: User) => number) | AttributeAccessor<any, T>,
  right:
    | ((resource: Resource) => number)
    | AttributeAccessor<any, T>
    | T
    | number,
): Rule | PredicateExpression {
  if (isAttributeAccessor(left)) {
    return algebraGe(left, right as AttributeAccessor<any, T> | T)
  }

  return ruleFromPredicate<User, Resource, unknown>(ctx => {
    const rightValue: number =
      typeof right === "function"
        ? (right as (resource: Resource) => number)(ctx.resource)
        : (right as number)

    return left(ctx.user) >= rightValue
  })
}

export const eqEnv = <Environment, T>(
  left: (environment: Environment) => T,
  right: T,
): Rule => {
  return ruleFromPredicate<unknown, unknown, Environment>(ctx => {
    return Object.is(left(ctx.environment), right)
  })
}

export const all = (...rules: Rule[]): Rule => and(...rules)

export const approve = (
  definition: RuleInput,
  options?: RuleOptions,
): RuleRef => {
  return buildRuleRef("approve", definition, options)
}

export const deny = (definition: RuleInput, options?: RuleOptions): RuleRef => {
  return buildRuleRef("deny", definition, options)
}

export const policy = (...rules: RuleRef[]): PolicyRef => {
  return {
    rules: [...rules],
  }
}

const collectReferencedABACTerms = (rule: Rule): Set<ABACContextTerm> => {
  const terms = new Set<ABACContextTerm>()

  const addTerm = (candidate: symbol): void => {
    if (isABACContextTerm(candidate)) {
      terms.add(candidate)
    }
  }

  const visit = (node: Rule): void => {
    switch (node.type) {
      case "relation":
        addTerm(node.left)
        addTerm(node.right)
        return
      case "unary":
        addTerm(node.term)
        if (isPredicateExpression(node.predicate)) {
          getPredicateExpressionTerms(node.predicate).forEach(addTerm)
        }
        return
      case "term":
      case "exists":
      case "eq-value":
        addTerm(node.term)
        return
      case "eq-term":
        addTerm(node.left)
        addTerm(node.right)
        return
      case "and":
      case "or":
        node.children.forEach(visit)
        return
      case "select":
        node.terms.forEach(addTerm)
        visit(node.child)
        return
      case "not":
      case "distinct":
      case "memo":
        visit(node.child)
        return
      case "forall":
        addTerm(node.term)
        visit(node.child)
        return
      case "given":
        visit(node.context)
        visit(node.rule)
        return
      case "derives":
        addTerm(node.entity)
        addTerm(node.from)
        return
      case "ref":
        return
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  visit(rule)
  return terms
}

export const buildEvalEnvironment = <User, Resource, Environment>(
  context: EvalContext<User, Resource, Environment>,
  options?: {
    readonly rule?: Rule
    readonly includeEvalContext?: boolean
  },
): Record<PropertyKey, unknown> => {
  const referencedTerms = options?.rule
    ? collectReferencedABACTerms(options.rule)
    : new Set<ABACContextTerm>([
        EVAL_CONTEXT_TERM,
        ACTION_TERM,
        USER_TERM,
        RESOURCE_TERM,
        ENVIRONMENT_TERM,
      ])
  const environment: Record<PropertyKey, unknown> = {}

  if (
    (options?.includeEvalContext ?? true) &&
    referencedTerms.has(EVAL_CONTEXT_TERM)
  ) {
    environment[EVAL_CONTEXT_TERM] = context
  }
  if (referencedTerms.has(ACTION_TERM)) {
    environment[ACTION_TERM] = context.action
  }
  if (referencedTerms.has(USER_TERM)) {
    environment[USER_TERM] = context.user
  }
  if (referencedTerms.has(RESOURCE_TERM)) {
    environment[RESOURCE_TERM] = context.resource
  }
  if (referencedTerms.has(ENVIRONMENT_TERM)) {
    environment[ENVIRONMENT_TERM] = context.environment
  }

  return environment
}

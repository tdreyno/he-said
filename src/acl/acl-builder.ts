import {
  and,
  annotateRule,
  type Rule,
  type RuleAnnotations,
  type Term,
  term,
} from "../core/algebra"
import type {
  ActionToken,
  CanContext,
  FailureToken,
  PolicyRef,
  ResourceToken,
  RuleKind,
  RuleOptions,
  RuleRef,
  RuleReferenceToken,
  SubjectToken,
} from "./acl-types"

export interface EvalContext<Subject, Resource, Environment> {
  readonly action: ActionToken
  readonly subject: Subject
  readonly resource: Resource
  readonly environment?: Environment
}

const ACTION_LABELS = new Map<ActionToken, string | undefined>()
const SUBJECT_LABELS = new Map<SubjectToken, string | undefined>()
const RESOURCE_LABELS = new Map<ResourceToken, string | undefined>()
const FAILURE_MESSAGES = new Map<FailureToken, string | undefined>()

const EVAL_CONTEXT_TERM = term<EvalContext<unknown, unknown, unknown>>()

type RuleInput = Rule | readonly Rule[]

const normalizeRuleInput = (input: RuleInput): Rule => {
  if (Array.isArray(input)) {
    return and(...(input as Rule[]))
  }

  return input as Rule
}

const contextTerm = <Subject, Resource, Environment>(): Term<
  EvalContext<Subject, Resource, Environment>
> => {
  return EVAL_CONTEXT_TERM as Term<EvalContext<Subject, Resource, Environment>>
}

const ruleFromPredicate = <Subject, Resource, Environment>(
  predicate: (ctx: EvalContext<Subject, Resource, Environment>) => boolean,
): Rule => {
  return and(contextTerm<Subject, Resource, Environment>().is(predicate))
}

const buildRuleRef = (
  kind: RuleKind,
  definition: RuleInput,
  options?: RuleOptions,
): RuleRef => {
  const compiledRule = normalizeRuleInput(definition)
  const reference = Symbol("acl.rule.ref") as RuleReferenceToken

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
  const value = Symbol(label ?? "acl.action") as ActionToken<TLabel>
  ACTION_LABELS.set(value as ActionToken, label)
  return value
}

export const subject = <TLabel extends string = string>(
  label?: TLabel,
): SubjectToken<TLabel> => {
  const value = Symbol(label ?? "acl.subject") as SubjectToken<TLabel>
  SUBJECT_LABELS.set(value as SubjectToken, label)
  return value
}

export const resource = <TLabel extends string = string>(
  label?: TLabel,
): ResourceToken<TLabel> => {
  const value = Symbol(label ?? "acl.resource") as ResourceToken<TLabel>
  RESOURCE_LABELS.set(value as ResourceToken, label)
  return value
}

export const actionLabel = (value: ActionToken): string | undefined => {
  return ACTION_LABELS.get(value)
}

export const subjectLabel = (value: SubjectToken): string | undefined => {
  return SUBJECT_LABELS.get(value)
}

export const resourceLabel = (value: ResourceToken): string | undefined => {
  return RESOURCE_LABELS.get(value)
}

export const failure = (message?: string): FailureToken => {
  const value = Symbol("acl.failure") as FailureToken
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

export const entry = (
  subjectToken: SubjectToken,
  resourceToken: ResourceToken,
  actionToken: ActionToken,
): Rule => {
  return ruleFromPredicate<unknown, unknown, unknown>(ctx => {
    return (
      Object.is(ctx.subject, subjectToken) &&
      Object.is(ctx.resource, resourceToken) &&
      Object.is(ctx.action, actionToken)
    )
  })
}

export function eq<Subject, T>(left: (subject: Subject) => T, right: T): Rule
export function eq<Subject, Resource, T>(
  left: (subject: Subject) => T,
  right: (resource: Resource) => T,
): Rule
export function eq<Subject, Resource, T>(
  left: (subject: Subject) => T,
  right: ((resource: Resource) => T) | T,
): Rule {
  return ruleFromPredicate<Subject, Resource, unknown>(ctx => {
    const rightValue =
      typeof right === "function"
        ? (right as (resource: Resource) => T)(ctx.resource)
        : right

    return Object.is(left(ctx.subject), rightValue)
  })
}

export const allow = (
  definition: RuleInput,
  options?: RuleOptions,
): RuleRef => {
  return buildRuleRef("allow", definition, options)
}

export const deny = (definition: RuleInput, options?: RuleOptions): RuleRef => {
  return buildRuleRef("deny", definition, options)
}

export const policy = (...rules: RuleRef[]): PolicyRef => {
  return {
    rules: [...rules],
  }
}

export const buildEvalEnvironment = <Subject, Resource, Environment>(
  context: EvalContext<Subject, Resource, Environment>,
): Record<PropertyKey, unknown> => {
  return {
    [EVAL_CONTEXT_TERM]: context,
  }
}

export const fromContext = <Subject, Resource, Environment>(
  actionToken: ActionToken,
  context: CanContext<Subject, Resource, Environment>,
): EvalContext<Subject, Resource, Environment> => {
  return {
    action: actionToken,
    subject: context.subject,
    resource: context.resource,
    environment: context.environment,
  }
}

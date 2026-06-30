import type { EvaluationProof, OutcomeToken, Rule } from "../core/algebra"

export type ActionToken<TLabel extends string = string> = symbol & {
  readonly __actionBrand?: { label: TLabel }
}

export type SubjectToken<TLabel extends string = string> = symbol & {
  readonly __subjectBrand?: { label: TLabel }
}

export type ResourceToken<TLabel extends string = string> = symbol & {
  readonly __resourceBrand?: { label: TLabel }
}

export type FailureToken = OutcomeToken & {
  readonly __failureBrand?: { message?: string }
}

export type RuleReferenceToken = symbol & {
  readonly __ruleReferenceBrand?: true
}

export type RuleKind = "allow" | "deny"

export interface RuleOptions {
  readonly name?: string
  readonly failure?: FailureToken
  readonly priority?: number
}

export interface RuleRef {
  readonly kind: RuleKind
  readonly ref: RuleReferenceToken
  readonly rule: Rule
  readonly name?: string
  readonly failure?: FailureToken
  readonly priority: number
}

export interface PolicyRef {
  readonly rules: readonly RuleRef[]
}

export interface CanContext<Subject, Resource, Environment> {
  readonly subject: Subject
  readonly resource: Resource
  readonly environment?: Environment
}

export interface RuleTrace {
  readonly ruleRef: RuleReferenceToken
  readonly name?: string
  readonly kind: RuleKind
  readonly matched: boolean
  readonly proof?: EvaluationProof
}

export interface DecisionTrace {
  readonly matchedRules: readonly RuleTrace[]
  readonly checkedRules: readonly RuleTrace[]
}

export interface CanDecision {
  readonly allowed: boolean
  readonly failureToken?: FailureToken
  readonly reason?: string
  readonly trace: DecisionTrace
}

export interface ACLEnforcer<Subject, Resource, Environment> {
  can(
    action: ActionToken,
    context: CanContext<Subject, Resource, Environment>,
  ): Promise<CanDecision>
  policy(): PolicyRef
}

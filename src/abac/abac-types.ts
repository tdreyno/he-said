import type {
  EvaluationProof,
  EvaluatorAdapter,
  OutcomeToken,
  Rule,
} from "../core/algebra"

export type ActionToken<TLabel extends string = string> = symbol & {
  readonly __actionBrand?: { label: TLabel }
}

export type FailureToken = OutcomeToken & {
  readonly __failureBrand?: { message?: string }
}

export type RuleReferenceToken = symbol & {
  readonly __ruleReferenceBrand?: true
}

export type RuleKind = "approve" | "deny"

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

export interface CanContext<User, Resource, Environment> {
  readonly user: User
  readonly resource: Resource
  readonly environment: Environment
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

export interface ABACEnforcer<User, Resource, Environment> {
  can(
    action: ActionToken,
    context: CanContext<User, Resource, Environment>,
  ): Promise<CanDecision>
  policy(): PolicyRef
}

export interface ABACEnforcerOptions<EvaluatorContext = unknown> {
  readonly adapter?: EvaluatorAdapter<
    Record<PropertyKey, unknown>,
    EvaluatorContext
  >
  readonly evaluatorContext?: EvaluatorContext
}

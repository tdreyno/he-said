import {
  evaluator,
  sortRulesByPriorityAndKind,
  type EvaluationProof,
} from "../core/algebra"
import { createInMemoryAdapter } from "../core/algebra-inmemory"
import {
  buildEvalEnvironment,
  failureMessage,
  type EvalContext,
} from "./abac-builder"
import type {
  ABACEnforcer,
  ABACEnforcerOptions,
  ActionToken,
  CanContext,
  CanDecision,
  PolicyRef,
  RuleRef,
  RuleTrace,
} from "./abac-types"

const proofToTrace = (
  rule: RuleRef,
  matched: boolean,
  proof?: EvaluationProof,
): RuleTrace => {
  return {
    ruleRef: rule.ref,
    name: rule.name,
    kind: rule.kind,
    matched,
    proof,
  }
}

export const enforcer = <User, Resource, Environment>(
  accessPolicy: PolicyRef,
  options?: ABACEnforcerOptions,
): ABACEnforcer<User, Resource, Environment> => {
  const evalEngine = evaluator(
    options?.adapter ?? createInMemoryAdapter({ relations: [] }),
    {
      evaluatorContext: options?.evaluatorContext,
    },
  )

  const createEvalEnvironment = (
    evalContext: EvalContext<User, Resource, Environment>,
    rule: RuleRef,
  ): Record<PropertyKey, unknown> => {
    return buildEvalEnvironment(evalContext, {
      rule: rule.rule,
      includeEvalContext: true,
    })
  }

  const orderedRules = sortRulesByPriorityAndKind(accessPolicy.rules, [
    "deny",
    "approve",
  ])

  const denyRules = orderedRules.filter(rule => rule.kind === "deny")
  const approveRules = orderedRules.filter(rule => rule.kind === "approve")

  const can = async (
    action: ActionToken,
    context: CanContext<User, Resource, Environment>,
  ): Promise<CanDecision> => {
    const evalContext: EvalContext<User, Resource, Environment> = {
      action,
      user: context.user,
      resource: context.resource,
      environment: context.environment,
    }

    const checkedRules: RuleTrace[] = []
    const matchedRules: RuleTrace[] = []

    for (const rule of denyRules) {
      const evalEnvironment = createEvalEnvironment(evalContext, rule)
      const proof = await evalEngine.evaluateWithProof(
        rule.rule,
        evalEnvironment,
      )
      const matched = proof.ok
      const trace = proofToTrace(rule, matched, proof)
      checkedRules.push(trace)

      if (matched) {
        matchedRules.push(trace)
        return {
          allowed: false,
          failureToken: rule.failure,
          reason: rule.failure ? failureMessage(rule.failure) : undefined,
          trace: {
            checkedRules,
            matchedRules,
          },
        }
      }
    }

    for (const rule of approveRules) {
      const evalEnvironment = createEvalEnvironment(evalContext, rule)
      const proof = await evalEngine.evaluateWithProof(
        rule.rule,
        evalEnvironment,
      )
      const matched = proof.ok
      const trace = proofToTrace(rule, matched, proof)
      checkedRules.push(trace)

      if (matched) {
        matchedRules.push(trace)
        return {
          allowed: true,
          trace: {
            checkedRules,
            matchedRules,
          },
        }
      }
    }

    return {
      allowed: false,
      trace: {
        checkedRules,
        matchedRules,
      },
    }
  }

  return {
    can,
    policy() {
      return accessPolicy
    },
  }
}

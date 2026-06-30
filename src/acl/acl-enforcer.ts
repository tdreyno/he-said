import {
  evaluator,
  sortRulesByPriorityAndKind,
  type EvaluationProof,
} from "../core/algebra"
import { createInMemoryAdapter } from "../core/algebra-inmemory"
import {
  buildEvalEnvironment,
  failureMessage,
  fromContext,
} from "./acl-builder"
import type {
  ACLEnforcer,
  ActionToken,
  CanContext,
  CanDecision,
  PolicyRef,
  RuleRef,
  RuleTrace,
} from "./acl-types"

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

export const enforcer = <Subject, Resource, Environment>(
  accessPolicy: PolicyRef,
): ACLEnforcer<Subject, Resource, Environment> => {
  const evalEngine = evaluator(createInMemoryAdapter({ relations: [] }), {
    evaluatorContext: undefined,
  })

  const orderedRules = sortRulesByPriorityAndKind(accessPolicy.rules, [
    "deny",
    "allow",
  ])

  const denyRules = orderedRules.filter(rule => rule.kind === "deny")
  const allowRules = orderedRules.filter(rule => rule.kind === "allow")

  const can = async (
    actionToken: ActionToken,
    context: CanContext<Subject, Resource, Environment>,
  ): Promise<CanDecision> => {
    const evalContext = fromContext(actionToken, context)
    const evalEnvironment = buildEvalEnvironment(evalContext)

    const checkedRules: RuleTrace[] = []
    const matchedRules: RuleTrace[] = []

    for (const rule of denyRules) {
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

    for (const rule of allowRules) {
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

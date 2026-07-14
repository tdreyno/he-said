import {
  describeAlgebraSymbol,
  getRuleAnnotations,
  type Environment,
  type Rule,
} from "./algebra"

/**
 * Allow-side explanations: deny proofs say which node had no rows, but
 * audits and support ask the opposite question — WHY did this actor get in?
 * `explainAllow` re-evaluates OR alternatives in order and reports the
 * choices that granted access, labeled for humans.
 *
 * Caveat (shared with deny probes): branches are evaluated independently,
 * so alternatives correlated through shared FREE terms can mis-attribute.
 * With fully bound environments — the typical `can(actor, resource)` shape —
 * OR branches are independent and attribution is exact.
 */

/** One OR choice on the winning path, outermost first. */
export interface AllowChoice {
  /** Index of the alternative that granted access. */
  readonly index: number
  /** Human label: rule annotation if present, else a structural summary. */
  readonly label: string
  /** The chosen alternative. */
  readonly rule: Rule
}

export type AllowExplanation =
  | { readonly ok: true; readonly choices: ReadonlyArray<AllowChoice> }
  | { readonly ok: false }

const SUMMARY_LIMIT = 3

/** Compact structural summary of a rule, for choice labels. */
export const summarizeRule = (rule: Rule): string => {
  const annotated = getRuleAnnotations(rule)?.label
  if (annotated) {
    return annotated
  }

  switch (rule.type) {
    case "relation":
      return describeAlgebraSymbol(rule.relationId)
    case "exists":
      return `exists(${describeAlgebraSymbol(rule.term as symbol)})`
    case "term":
    case "eq-value":
    case "unary":
      return describeAlgebraSymbol(rule.term as symbol)
    case "eq-term":
      return `${describeAlgebraSymbol(rule.left as symbol)} = ${describeAlgebraSymbol(rule.right as symbol)}`
    case "derives":
      return `derives(${describeAlgebraSymbol(rule.entity as symbol)})`
    case "ref":
      return rule.name
    case "and": {
      const parts = rule.children.slice(0, SUMMARY_LIMIT).map(summarizeRule)
      const suffix = rule.children.length > SUMMARY_LIMIT ? " ∧ …" : ""
      return `${parts.join(" ∧ ")}${suffix}`
    }
    case "or": {
      const parts = rule.children.slice(0, SUMMARY_LIMIT).map(summarizeRule)
      const suffix = rule.children.length > SUMMARY_LIMIT ? " | …" : ""
      return `${parts.join(" | ")}${suffix}`
    }
    case "not":
      return `not(${summarizeRule(rule.child)})`
    case "forall":
      return `forall(${describeAlgebraSymbol(rule.term as symbol)})`
    case "given":
      return summarizeRule(rule.rule)
    case "select":
    case "distinct":
    case "memo":
      return summarizeRule(rule.child)
  }
}

const containsOr = (rule: Rule): boolean => {
  switch (rule.type) {
    case "or":
      return true
    case "and":
      return rule.children.some(containsOr)
    case "not":
    case "forall":
    case "select":
    case "distinct":
    case "memo":
      return containsOr(rule.child)
    case "given":
      return containsOr(rule.rule) || containsOr(rule.context)
    default:
      return false
  }
}

interface Evaluates<Env extends Environment> {
  evaluate(rule: Rule, environment: Readonly<Env>): Promise<boolean>
}

/**
 * Explain WHY `rule` allows under `environment`: returns `{ ok: false }`
 * when it does not, otherwise the ordered OR choices that granted access.
 * Probe cost mirrors deny proofs: one evaluation per alternative until the
 * winning one is found, on the rare (explicitly requested) path.
 */
export const explainAllow = async <Env extends Environment>(
  engine: Evaluates<Env>,
  rule: Rule,
  environment: Readonly<Env>,
): Promise<AllowExplanation> => {
  if (!(await engine.evaluate(rule, environment))) {
    return { ok: false }
  }

  const choices: Array<AllowChoice> = []

  const descend = async (node: Rule): Promise<void> => {
    switch (node.type) {
      case "or": {
        for (let index = 0; index < node.children.length; index += 1) {
          const child = node.children[index]!
          if (await engine.evaluate(child, environment)) {
            choices.push({ index, label: summarizeRule(child), rule: child })
            await descend(child)
            return
          }
        }
        return
      }
      case "and": {
        for (const child of node.children) {
          if (containsOr(child)) {
            await descend(child)
          }
        }
        return
      }
      case "not":
      case "forall":
      case "select":
      case "distinct":
      case "memo":
        await descend(node.child)
        return
      case "given":
        await descend(node.rule)
        return
      default:
        return
    }
  }

  await descend(rule)

  return { ok: true, choices }
}

import { getRuleAnnotations, type Relation, type Rule } from "./algebra"
import { summarizeRule } from "./explain"

/**
 * Static policy analysis: find the rule smells that hide in combinator
 * trees — OR alternatives subsumed by a more general sibling (dead grants
 * that can never affect a verdict), duplicated branches, contradictions
 * buried among other conjuncts, and relations declared but never used.
 *
 * The motivating case: a policy carried `or(read(members), read(members ∧
 * shared))` for months — the second grant was unreachable dead code, and no
 * amount of testing showed it, because removing it changes no verdict.
 */

export type PolicyFindingKind =
  | "subsumed-or-branch"
  | "duplicate-branch"
  | "buried-contradiction"
  | "unused-relation"

export interface PolicyFinding {
  readonly kind: PolicyFindingKind
  /** Name of the rule (from the analyzed record) the finding is inside. */
  readonly rule?: string
  readonly message: string
}

export interface AnalyzePolicyOptions {
  /** Relations the model declares — reported when no rule references them. */
  readonly relations?: ReadonlyArray<Relation<any, any>>
}

/** Structural rule equality: symbols by identity, predicates by value. */
export const ruleEquals = (a: Rule, b: Rule): boolean => {
  if (a === b) {
    return true
  }
  if (a.type !== b.type) {
    return false
  }

  switch (a.type) {
    case "relation": {
      const other = b as typeof a
      return (
        a.relationId === other.relationId &&
        a.left === other.left &&
        a.right === other.right &&
        JSON.stringify(a.predicates ?? null) ===
          JSON.stringify(other.predicates ?? null)
      )
    }
    case "exists":
    case "term":
      return a.term === (b as typeof a).term
    case "eq-term": {
      const other = b as typeof a
      return a.left === other.left && a.right === other.right
    }
    case "eq-value": {
      const other = b as typeof a
      return a.term === other.term && Object.is(a.value, other.value)
    }
    case "unary": {
      const other = b as typeof a
      return a.term === other.term && a.predicate === other.predicate
    }
    case "derives": {
      const other = b as typeof a
      return a.entity === other.entity && a.from === other.from
    }
    case "ref":
      return a.name === (b as typeof a).name
    case "and":
    case "or": {
      const other = b as typeof a
      return (
        a.children.length === other.children.length &&
        a.children.every((child, index) =>
          ruleEquals(child, other.children[index]!),
        )
      )
    }
    case "not":
    case "distinct":
      return ruleEquals(a.child, (b as typeof a).child)
    case "forall": {
      const other = b as typeof a
      return a.term === other.term && ruleEquals(a.child, other.child)
    }
    case "memo": {
      const other = b as typeof a
      return a.name === other.name && ruleEquals(a.child, other.child)
    }
    case "select": {
      const other = b as typeof a
      return (
        a.terms.length === other.terms.length &&
        a.terms.every((entry, index) => entry === other.terms[index]) &&
        ruleEquals(a.child, other.child)
      )
    }
    case "given": {
      const other = b as typeof a
      return (
        ruleEquals(a.rule, other.rule) && ruleEquals(a.context, other.context)
      )
    }
  }
}

/** A branch's conjunct set: and-children flattened, else the branch itself. */
const conjunctsOf = (rule: Rule): ReadonlyArray<Rule> => {
  return rule.type === "and" ? rule.children : [rule]
}

/** Every conjunct of `a` appears (structurally) among `b`'s conjuncts. */
const conjunctsSubset = (
  a: ReadonlyArray<Rule>,
  b: ReadonlyArray<Rule>,
): boolean => {
  return a.every(entry => b.some(candidate => ruleEquals(entry, candidate)))
}

const branchLabel = (rule: Rule): string => {
  return getRuleAnnotations(rule)?.label ?? summarizeRule(rule)
}

const analyzeNode = (
  node: Rule,
  ruleName: string | undefined,
  findings: Array<PolicyFinding>,
): void => {
  switch (node.type) {
    case "or": {
      for (let a = 0; a < node.children.length; a += 1) {
        for (let b = 0; b < node.children.length; b += 1) {
          if (a === b) {
            continue
          }
          const branchA = node.children[a]!
          const branchB = node.children[b]!
          if (ruleEquals(branchA, branchB)) {
            if (a < b) {
              findings.push({
                kind: "duplicate-branch",
                rule: ruleName,
                message: `OR has identical alternatives ${a} and ${b} (${branchLabel(branchA)})`,
              })
            }
            continue
          }
          // A ⊆ B conjunct-wise means B demands everything A demands and
          // more — anything satisfying B satisfies A, so B never decides.
          if (
            conjunctsSubset(conjunctsOf(branchA), conjunctsOf(branchB)) &&
            conjunctsOf(branchA).length < conjunctsOf(branchB).length
          ) {
            findings.push({
              kind: "subsumed-or-branch",
              rule: ruleName,
              message: `OR alternative ${b} (${branchLabel(branchB)}) is subsumed by the more general alternative ${a} (${branchLabel(branchA)}) — it can never change a verdict`,
            })
          }
        }
      }
      node.children.forEach(child => analyzeNode(child, ruleName, findings))
      return
    }

    case "and": {
      // The exact and(X, not(X)) pair is the canonical "never" idiom
      // (grant.deny) — intentional. A contradiction is only suspicious when
      // buried among OTHER conjuncts.
      const children = node.children
      const isPureNever =
        children.length === 2 &&
        ((children[1]!.type === "not" &&
          ruleEquals(children[0]!, children[1]!.child)) ||
          (children[0]!.type === "not" &&
            ruleEquals(children[0]!.child, children[1]!)))
      if (!isPureNever && children.length > 2) {
        for (const child of children) {
          if (child.type !== "not") {
            continue
          }
          const negated = child.child
          if (
            children.some(
              sibling => sibling !== child && ruleEquals(sibling, negated),
            )
          ) {
            findings.push({
              kind: "buried-contradiction",
              rule: ruleName,
              message: `AND contains both ${branchLabel(negated)} and its negation among other conjuncts — the whole conjunction is unsatisfiable`,
            })
          }
        }
      }
      children.forEach(child => analyzeNode(child, ruleName, findings))
      return
    }

    case "not":
    case "forall":
    case "select":
    case "distinct":
    case "memo":
      analyzeNode(node.child, ruleName, findings)
      return

    case "given":
      analyzeNode(node.context, ruleName, findings)
      analyzeNode(node.rule, ruleName, findings)
      return

    default:
      return
  }
}

const collectRelationIds = (node: Rule, used: Set<symbol>): void => {
  switch (node.type) {
    case "relation":
      used.add(node.relationId)
      return
    case "and":
    case "or":
      node.children.forEach(child => collectRelationIds(child, used))
      return
    case "not":
    case "forall":
    case "select":
    case "distinct":
    case "memo":
      collectRelationIds(node.child, used)
      return
    case "given":
      collectRelationIds(node.context, used)
      collectRelationIds(node.rule, used)
      return
    default:
      return
  }
}

/**
 * Lint a rule or a named rule set. Pass the model's relations to also get
 * unused-relation findings. Returns an empty array for a clean policy.
 */
export const analyzePolicy = (
  rules: Rule | Readonly<Record<string, Rule | null | undefined>>,
  options: AnalyzePolicyOptions = {},
): ReadonlyArray<PolicyFinding> => {
  const findings: Array<PolicyFinding> = []
  const entries: Array<[string | undefined, Rule]> =
    typeof (rules as { type?: unknown }).type === "string"
      ? [[undefined, rules as Rule]]
      : Object.entries(rules as Record<string, Rule | null | undefined>)
          .filter((entry): entry is [string, Rule] => entry[1] != null)
          .map(([name, rule]) => [name, rule])

  const usedRelations = new Set<symbol>()
  for (const [name, rule] of entries) {
    analyzeNode(rule, name, findings)
    collectRelationIds(rule, usedRelations)
  }

  options.relations?.forEach(relation => {
    if (!usedRelations.has(relation.id)) {
      findings.push({
        kind: "unused-relation",
        message: `relation "${relation.id.description ?? "(anonymous)"}" is declared but referenced by no analyzed rule`,
      })
    }
  })

  return findings
}

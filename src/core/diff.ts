import { type Rule } from "./algebra"
import { ruleEquals } from "./analyze"
import { summarizeRule } from "./explain"

/**
 * Semantic policy diffing: compare two rules (or two named rule sets) at the
 * TREE level and report what changed in policy language — "System.read:
 * added OR alternative (orgShared ∧ teamInOrg)" — instead of a textual SQL
 * or source diff. Ideal for CI comments on policy PRs; complements golden
 * SQL snapshots, which churn on planner changes even when semantics don't.
 */

export type RuleChangeKind =
  | "added-alternative"
  | "removed-alternative"
  | "added-conjunct"
  | "removed-conjunct"
  | "changed"
  | "added-rule"
  | "removed-rule"

export interface RuleChange {
  readonly kind: RuleChangeKind
  /** Name of the rule (from the compared records) the change is inside. */
  readonly rule?: string
  readonly message: string
}

const describeBranches = (branches: ReadonlyArray<Rule>): string => {
  return branches.map(branch => `(${summarizeRule(branch)})`).join(", ")
}

/** Children of a node when it is the given combinator, else the node itself. */
const childrenAs = (rule: Rule, type: "and" | "or"): ReadonlyArray<Rule> => {
  return rule.type === type ? rule.children : [rule]
}

const diffBranchSets = (
  before: ReadonlyArray<Rule>,
  after: ReadonlyArray<Rule>,
): { added: Array<Rule>; removed: Array<Rule> } => {
  const added = after.filter(
    branch => !before.some(prev => ruleEquals(prev, branch)),
  )
  const removed = before.filter(
    branch => !after.some(next => ruleEquals(next, branch)),
  )
  return { added, removed }
}

const diffOne = (
  before: Rule,
  after: Rule,
  name: string | undefined,
  changes: Array<RuleChange>,
): void => {
  if (ruleEquals(before, after)) {
    return
  }

  // OR-level: report alternatives that appeared/disappeared.
  if (before.type === "or" || after.type === "or") {
    const { added, removed } = diffBranchSets(
      childrenAs(before, "or"),
      childrenAs(after, "or"),
    )

    // A single changed pair reads better as a recursive diff than as
    // remove+add — recurse when exactly one branch changed on each side.
    if (added.length === 1 && removed.length === 1) {
      diffOne(removed[0]!, added[0]!, name, changes)
      return
    }

    if (added.length > 0) {
      changes.push({
        kind: "added-alternative",
        rule: name,
        message: `added OR alternative${added.length > 1 ? "s" : ""}: ${describeBranches(added)}`,
      })
    }
    if (removed.length > 0) {
      changes.push({
        kind: "removed-alternative",
        rule: name,
        message: `removed OR alternative${removed.length > 1 ? "s" : ""}: ${describeBranches(removed)}`,
      })
    }
    if (added.length === 0 && removed.length === 0) {
      changes.push({
        kind: "changed",
        rule: name,
        message: `OR alternatives reordered (verdicts unchanged, proof/explain order differs)`,
      })
    }
    return
  }

  // AND-level: report conjuncts that appeared/disappeared (tightening /
  // loosening of a grant).
  if (before.type === "and" || after.type === "and") {
    const { added, removed } = diffBranchSets(
      childrenAs(before, "and"),
      childrenAs(after, "and"),
    )

    if (added.length === 1 && removed.length === 1) {
      diffOne(removed[0]!, added[0]!, name, changes)
      return
    }

    if (added.length > 0) {
      changes.push({
        kind: "added-conjunct",
        rule: name,
        message: `tightened: added condition${added.length > 1 ? "s" : ""} ${describeBranches(added)}`,
      })
    }
    if (removed.length > 0) {
      changes.push({
        kind: "removed-conjunct",
        rule: name,
        message: `loosened: removed condition${removed.length > 1 ? "s" : ""} ${describeBranches(removed)}`,
      })
    }
    if (added.length === 0 && removed.length === 0) {
      changes.push({
        kind: "changed",
        rule: name,
        message: "AND conjuncts reordered (verdicts unchanged)",
      })
    }
    return
  }

  changes.push({
    kind: "changed",
    rule: name,
    message: `changed: (${summarizeRule(before)}) → (${summarizeRule(after)})`,
  })
}

type RuleRecord = Readonly<Record<string, Rule | null | undefined>>

const isRuleValue = (value: unknown): value is Rule => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

/**
 * Diff two rules or two named rule sets. Returns an empty array when the
 * policies are structurally identical.
 */
export const diffRules = (
  before: Rule | RuleRecord,
  after: Rule | RuleRecord,
): ReadonlyArray<RuleChange> => {
  const changes: Array<RuleChange> = []

  if (isRuleValue(before) && isRuleValue(after)) {
    diffOne(before, after, undefined, changes)
    return changes
  }

  const beforeRecord = (isRuleValue(before) ? {} : before) as RuleRecord
  const afterRecord = (isRuleValue(after) ? {} : after) as RuleRecord
  const names = new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ])

  for (const name of names) {
    const prev = beforeRecord[name]
    const next = afterRecord[name]
    if (prev && !next) {
      changes.push({
        kind: "removed-rule",
        rule: name,
        message: `rule removed`,
      })
      continue
    }
    if (!prev && next) {
      changes.push({ kind: "added-rule", rule: name, message: `rule added` })
      continue
    }
    if (prev && next) {
      diffOne(prev, next, name, changes)
    }
  }

  return changes
}

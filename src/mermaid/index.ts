import {
  getRuleAnnotations,
  isAttributeAccessor,
  isFact,
  type PredicateExpression,
  type Rule,
  type SourcePredicate,
} from "../core/algebra"

/**
 * Mermaid DECISION TREES from rule algebra: each check (relation hop, fact,
 * existence, predicate) becomes a yes/no decision node, AND chains follow
 * the "yes" edges, OR alternatives are the "no"-edge fall-throughs, and
 * every path terminates in ALLOW or DENY — the chart reads as the
 * short-circuit evaluation a reviewer would trace by hand, not as a
 * boolean-algebra structure diagram.
 *
 * Relations and terms are runtime Symbols; readable labels come from (in
 * precedence order) the options' name maps, rule annotations, and the
 * symbols' own descriptions.
 */

export interface MermaidOptions {
  /** Flow direction. Default "TD". */
  direction?: "TD" | "LR"
  /** relationId → display name (e.g. built by introspecting a model module). */
  relationNames?: ReadonlyMap<symbol, string>
  /** term/fact symbol → display name, overriding the symbol description. */
  termNames?: ReadonlyMap<symbol, string>
}

const RULE_TYPES = new Set([
  "relation",
  "unary",
  "term",
  "exists",
  "eq-term",
  "eq-value",
  "ref",
  "and",
  "or",
  "not",
  "forall",
  "select",
  "distinct",
  "memo",
  "derives",
  "given",
])

/** Whether a value is (shaped like) a rule algebra node. */
export const isRule = (value: unknown): value is Rule => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    RULE_TYPES.has((value as { type: string }).type)
  )
}

const escapeLabel = (label: string): string => {
  return label.replace(/"/g, "#quot;")
}

const LABEL_PREFIX = /^rules\.(?:term|fact|relation)\.(?!derived$)(.+)$/

const symbolLabel = (
  value: unknown,
  names: ReadonlyMap<symbol, string> | undefined,
  fallback: string,
): string => {
  if (typeof value !== "symbol") {
    return fallback
  }
  const named = names?.get(value)
  if (named) {
    return named
  }
  const description = value.description
  if (!description) {
    return fallback
  }
  if (!description.startsWith("rules.")) {
    return description
  }
  // Labeled algebra symbols look like "rules.term.team" — surface the label;
  // unlabeled ("rules.term", "rules.term.derived") fall back.
  const match = LABEL_PREFIX.exec(description)
  return match ? match[1]! : fallback
}

const formatValue = (value: unknown): string => {
  if (typeof value === "string") {
    return `'${value}'`
  }
  if (typeof value === "symbol") {
    return value.description ?? "symbol"
  }
  if (value === null) {
    return "null"
  }
  return String(value)
}

const formatOperand = (operand: unknown, options: MermaidOptions): string => {
  if (isAttributeAccessor(operand)) {
    const accessor = operand as unknown as { term: unknown; column: string }
    return `${symbolLabel(accessor.term, options.termNames, "term")}.${accessor.column}`
  }
  if (typeof operand === "symbol") {
    return symbolLabel(operand, options.termNames, "term")
  }
  return formatValue(operand)
}

const COMPARATORS: Record<string, string> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
}

const formatPredicateExpression = (
  predicate: PredicateExpression,
  options: MermaidOptions,
): string => {
  if (predicate.operator === "one-of") {
    const values = predicate.values.map(formatValue).join(", ")
    return `${formatOperand(predicate.left, options)} in [${values}]`
  }
  if (predicate.operator === "is-null") {
    return `${formatOperand(predicate.operand, options)} is null`
  }
  if (predicate.operator === "is-not-null") {
    return `${formatOperand(predicate.operand, options)} is not null`
  }
  const symbol = COMPARATORS[predicate.operator] ?? predicate.operator
  return `${formatOperand(predicate.left, options)} ${symbol} ${formatOperand(
    predicate.right,
    options,
  )}`
}

const formatSourcePredicate = (predicate: SourcePredicate): string => {
  if (predicate.op === "in") {
    return `${predicate.column} in [${predicate.values.map(formatValue).join(", ")}]`
  }
  const symbol = COMPARATORS[predicate.op] ?? predicate.op
  return `${predicate.column} ${symbol} ${formatValue(
    (predicate as { value?: unknown }).value,
  )}`
}

const isPredicateExpressionValue = (
  value: unknown,
): value is PredicateExpression => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "predicate-expression"
  )
}

type EmitState = {
  lines: Array<string>
  nextId: number
  prefix: string
  options: MermaidOptions
}

const nextNode = (state: EmitState): string => {
  const id = `${state.prefix}${state.nextId}`
  state.nextId += 1
  return id
}

/** Emit a yes/no decision node (rhombus), returning its id. */
const emitDecision = (state: EmitState, label: string): string => {
  const id = nextNode(state)
  state.lines.push(`  ${id}{"${escapeLabel(label)}"}`)
  return id
}

const emitYes = (state: EmitState, from: string, to: string): void => {
  state.lines.push(`  ${from} -- yes --> ${to}`)
}

const emitNo = (state: EmitState, from: string, to: string): void => {
  state.lines.push(`  ${from} -- no --> ${to}`)
}

const annotatedLabel = (rule: Rule, base: string): string => {
  const label = getRuleAnnotations(rule)?.label
  return label ? `${label}: ${base}` : base
}

/** The question a leaf check asks, phrased for a decision node. */
const leafLabel = (rule: Rule, options: MermaidOptions): string => {
  switch (rule.type) {
    case "relation": {
      const name = symbolLabel(
        rule.relationId,
        options.relationNames,
        "relation",
      )
      const left = symbolLabel(rule.left, options.termNames, "left")
      const right = symbolLabel(rule.right, options.termNames, "right")
      const predicates = (rule.predicates ?? [])
        .map(predicate => ` with ${formatSourcePredicate(predicate)}`)
        .join("")
      return `${name}: ${left} → ${right}${predicates}?`
    }

    case "exists":
      return `${symbolLabel(rule.term, options.termNames, "term")} exists?`

    case "eq-term":
      return `${symbolLabel(rule.left, options.termNames, "left")} = ${symbolLabel(
        rule.right,
        options.termNames,
        "right",
      )}?`

    case "eq-value": {
      const name = symbolLabel(rule.term, options.termNames, "term")
      if (isFact(rule.term) && rule.value === true) {
        return `${name}?`
      }
      return `${name} = ${formatValue(rule.value)}?`
    }

    case "term":
      return `${symbolLabel(rule.term, options.termNames, "term")}?`

    case "unary": {
      const term = symbolLabel(rule.term, options.termNames, "term")
      return isPredicateExpressionValue(rule.predicate)
        ? `${formatPredicateExpression(rule.predicate, options)}?`
        : `predicate(${term})?`
    }

    case "derives":
      return `${symbolLabel(rule.entity, options.termNames, "entity")} derives from ${symbolLabel(
        rule.from,
        options.termNames,
        "from",
      )}?`

    case "ref":
      return `${rule.name}?`

    default:
      throw new Error(`not a leaf rule node: ${rule.type}`)
  }
}

/**
 * Emit `rule` as short-circuit decisions: evaluation enters at the returned
 * node id; every internal path eventually reaches `onPass` or `onFail`.
 * AND wires each child's "yes" to the next child; OR wires each
 * alternative's failure to the next alternative; NOT swaps the targets.
 */
const emitRule = (
  rule: Rule,
  state: EmitState,
  onPass: string,
  onFail: string,
): string => {
  const { options } = state

  switch (rule.type) {
    case "and": {
      let next = onPass
      for (let index = rule.children.length - 1; index >= 0; index -= 1) {
        next = emitRule(rule.children[index]!, state, next, onFail)
      }
      return next
    }

    case "or": {
      let next = onFail
      for (let index = rule.children.length - 1; index >= 0; index -= 1) {
        next = emitRule(rule.children[index]!, state, onPass, next)
      }
      return next
    }

    case "not":
      return emitRule(rule.child, state, onFail, onPass)

    case "given":
      // Context must hold, then the rule — an AND in evaluation order.
      return emitRule(
        rule.context,
        state,
        emitRule(rule.rule, state, onPass, onFail),
        onFail,
      )

    case "forall":
    case "select":
    case "distinct":
    case "memo":
      // Quantifier/planner wrappers — decisions flow through the child.
      return emitRule(rule.child, state, onPass, onFail)

    default: {
      const decision = emitDecision(
        state,
        annotatedLabel(rule, leafLabel(rule, options)),
      )
      emitYes(state, decision, onPass)
      emitNo(state, decision, onFail)
      return decision
    }
  }
}

const STYLE_LINES = [
  "  classDef allow fill:#e6f4ea,stroke:#137333,color:#137333",
  "  classDef deny fill:#fce8e6,stroke:#c5221f,color:#c5221f",
]

const emitOutcomes = (state: EmitState): { allow: string; deny: string } => {
  const allow = nextNode(state)
  state.lines.push(`  ${allow}(["ALLOW"]):::allow`)
  const deny = nextNode(state)
  state.lines.push(`  ${deny}(["DENY"]):::deny`)
  return { allow, deny }
}

/** One rule → one decision-tree `flowchart` ending in ALLOW / DENY. */
export const ruleToMermaid = (
  rule: Rule,
  options: MermaidOptions = {},
): string => {
  const state: EmitState = {
    lines: [`flowchart ${options.direction ?? "TD"}`, ...STYLE_LINES],
    nextId: 0,
    prefix: "n",
    options,
  }
  const { allow, deny } = emitOutcomes(state)
  emitRule(rule, state, allow, deny)
  return state.lines.join("\n")
}

/**
 * A named rule set — e.g. a policy's per-action rules, or a whole
 * `Record<resource, Record<action, Rule>>` flattened by the caller — as one
 * flowchart with a decision-tree subgraph (own ALLOW/DENY) per entry.
 * Null/undefined entries are skipped.
 */
export const rulesToMermaid = (
  rules: Readonly<Record<string, Rule | null | undefined>>,
  options: MermaidOptions = {},
): string => {
  const state: EmitState = {
    lines: [`flowchart ${options.direction ?? "TD"}`, ...STYLE_LINES],
    nextId: 0,
    prefix: "n",
    options,
  }

  let subgraphIndex = 0
  for (const [name, rule] of Object.entries(rules)) {
    if (!rule) {
      continue
    }
    state.lines.push(`  subgraph s${subgraphIndex}["${escapeLabel(name)}"]`)
    subgraphIndex += 1
    const { allow, deny } = emitOutcomes(state)
    emitRule(rule, state, allow, deny)
    state.lines.push("  end")
  }

  return state.lines.join("\n")
}

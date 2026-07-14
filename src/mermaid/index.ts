import {
  getRuleAnnotations,
  isAttributeAccessor,
  isFact,
  type PredicateExpression,
  type Rule,
  type SourcePredicate,
} from "../core/algebra"

/**
 * Mermaid flow charts from rule algebra: walk a Rule tree and emit a
 * `flowchart` document, so a policy's shape — the ANDs, ORs, relation hops,
 * predicates, and existence checks behind each action — is reviewable as a
 * diagram instead of nested combinators.
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

/** Emit one node, returning its id. Shapes: junctions {{ }}, checks ([ ]), leaves [ ]. */
const emitNode = (
  state: EmitState,
  shape: "junction" | "check" | "leaf",
  label: string,
): string => {
  const id = nextNode(state)
  const escaped = escapeLabel(label)
  if (shape === "junction") {
    state.lines.push(`  ${id}{{"${escaped}"}}`)
  } else if (shape === "check") {
    state.lines.push(`  ${id}(["${escaped}"])`)
  } else {
    state.lines.push(`  ${id}["${escaped}"]`)
  }
  return id
}

const emitEdge = (state: EmitState, from: string, to: string): void => {
  state.lines.push(`  ${from} --> ${to}`)
}

const annotatedLabel = (rule: Rule, base: string): string => {
  const label = getRuleAnnotations(rule)?.label
  return label ? `${label}: ${base}` : base
}

const emitRule = (rule: Rule, state: EmitState): string => {
  const { options } = state

  switch (rule.type) {
    case "and":
    case "or": {
      const junction = emitNode(
        state,
        "junction",
        annotatedLabel(rule, rule.type.toUpperCase()),
      )
      rule.children.forEach(child => {
        emitEdge(state, junction, emitRule(child, state))
      })
      return junction
    }

    case "not": {
      const junction = emitNode(state, "junction", annotatedLabel(rule, "NOT"))
      emitEdge(state, junction, emitRule(rule.child, state))
      return junction
    }

    case "forall": {
      const junction = emitNode(
        state,
        "junction",
        annotatedLabel(
          rule,
          `FORALL ${symbolLabel(rule.term, options.termNames, "term")}`,
        ),
      )
      emitEdge(state, junction, emitRule(rule.child, state))
      return junction
    }

    case "given": {
      const junction = emitNode(
        state,
        "junction",
        annotatedLabel(rule, "GIVEN"),
      )
      const context = emitRule(rule.context, state)
      const inner = emitRule(rule.rule, state)
      state.lines.push(`  ${junction} -->|context| ${context}`)
      state.lines.push(`  ${junction} -->|rule| ${inner}`)
      return junction
    }

    case "select":
    case "distinct":
      // Planner hints — invisible to authorization semantics; pass through.
      return emitRule(rule.child, state)

    case "memo": {
      const junction = emitNode(
        state,
        "junction",
        annotatedLabel(rule, `MEMO ${rule.name}`),
      )
      emitEdge(state, junction, emitRule(rule.child, state))
      return junction
    }

    case "relation": {
      const name = symbolLabel(
        rule.relationId,
        options.relationNames,
        "relation",
      )
      const left = symbolLabel(rule.left, options.termNames, "left")
      const right = symbolLabel(rule.right, options.termNames, "right")
      const predicates = (rule.predicates ?? [])
        .map(predicate => ` [${formatSourcePredicate(predicate)}]`)
        .join("")
      return emitNode(
        state,
        "leaf",
        annotatedLabel(rule, `${name}(${left} → ${right})${predicates}`),
      )
    }

    case "exists":
      return emitNode(
        state,
        "check",
        annotatedLabel(
          rule,
          `exists(${symbolLabel(rule.term, options.termNames, "term")})`,
        ),
      )

    case "eq-term":
      return emitNode(
        state,
        "check",
        annotatedLabel(
          rule,
          `${symbolLabel(rule.left, options.termNames, "left")} = ${symbolLabel(
            rule.right,
            options.termNames,
            "right",
          )}`,
        ),
      )

    case "eq-value": {
      const kind = isFact(rule.term) ? "fact " : ""
      return emitNode(
        state,
        "check",
        annotatedLabel(
          rule,
          `${kind}${symbolLabel(rule.term, options.termNames, "term")} = ${formatValue(rule.value)}`,
        ),
      )
    }

    case "term":
      return emitNode(
        state,
        "check",
        annotatedLabel(
          rule,
          `${isFact(rule.term) ? "fact " : ""}${symbolLabel(
            rule.term,
            options.termNames,
            "term",
          )}`,
        ),
      )

    case "unary": {
      const term = symbolLabel(rule.term, options.termNames, "term")
      const label = isPredicateExpressionValue(rule.predicate)
        ? formatPredicateExpression(rule.predicate, options)
        : `predicate(${term})`
      return emitNode(state, "check", annotatedLabel(rule, label))
    }

    case "derives":
      return emitNode(
        state,
        "check",
        annotatedLabel(
          rule,
          `derives(${symbolLabel(rule.entity, options.termNames, "entity")} ← ${symbolLabel(
            rule.from,
            options.termNames,
            "from",
          )})`,
        ),
      )

    case "ref":
      return emitNode(state, "leaf", annotatedLabel(rule, `ref: ${rule.name}`))

    default: {
      const exhausted: never = rule
      throw new Error(
        `unknown rule node type: ${(exhausted as { type?: string }).type}`,
      )
    }
  }
}

/** One rule → one `flowchart` document. */
export const ruleToMermaid = (
  rule: Rule,
  options: MermaidOptions = {},
): string => {
  const state: EmitState = {
    lines: [`flowchart ${options.direction ?? "TD"}`],
    nextId: 0,
    prefix: "n",
    options,
  }
  emitRule(rule, state)
  return state.lines.join("\n")
}

/**
 * A named rule set — e.g. a policy's per-action rules, or a whole
 * `Record<resource, Record<action, Rule>>` flattened by the caller — as one
 * flowchart with a subgraph per entry. Null/undefined entries are skipped.
 */
export const rulesToMermaid = (
  rules: Readonly<Record<string, Rule | null | undefined>>,
  options: MermaidOptions = {},
): string => {
  const state: EmitState = {
    lines: [`flowchart ${options.direction ?? "TD"}`],
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
    emitRule(rule, state)
    state.lines.push("  end")
  }

  return state.lines.join("\n")
}

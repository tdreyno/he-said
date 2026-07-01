import {
  type AttributeAccessor,
  buildEvaluationProofDetails,
  type Environment,
  type EvaluationProof,
  type EvaluatorAdapter,
  getPredicateExpressionTerms,
  isAttributeAccessor,
  isPredicateExpression,
  type PredicateExpression,
  type Relation,
  type Rule,
  type SourceOrdering,
  type SourcePredicate,
  type Term,
} from "./algebra"

type AnyTerm = Term<unknown>

type FactPair = readonly [unknown, unknown]

type RelationFacts = Map<symbol, Array<FactPair>>

type RelationUse = {
  relationId: symbol
  side: "left" | "right"
}

type Analysis = {
  relationUses: Map<AnyTerm, Array<RelationUse>>
}

const hasBinding = (
  environment: Readonly<Environment>,
  key: symbol,
): boolean => {
  return Object.prototype.hasOwnProperty.call(environment, key)
}

const bindValue = <Env extends Environment>(
  environment: Readonly<Env>,
  key: symbol,
  value: unknown,
): Env => {
  return {
    ...environment,
    [key]: value,
  } as Env
}

const addRelationUse = (
  analysis: Analysis,
  term: AnyTerm,
  relationId: symbol,
  side: "left" | "right",
): void => {
  const existing = analysis.relationUses.get(term) ?? []
  existing.push({ relationId, side })
  analysis.relationUses.set(term, existing)
}

const analyzeRule = (rule: Rule): Analysis => {
  const analysis: Analysis = {
    relationUses: new Map(),
  }

  const visit = (node: Rule): void => {
    switch (node.type) {
      case "relation":
        addRelationUse(analysis, node.left as AnyTerm, node.relationId, "left")
        addRelationUse(
          analysis,
          node.right as AnyTerm,
          node.relationId,
          "right",
        )
        return
      case "unary":
      case "term":
      case "eq-term":
      case "eq-value":
      case "ref":
        return
      case "and":
      case "or":
        node.children.forEach(visit)
        return
      case "not":
      case "distinct":
      case "memo":
      case "select":
        visit(node.child)
        return
      case "forall":
        visit(node.child)
        return
      case "derives":
      case "given":
        return
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  visit(rule)
  return analysis
}

const collectCandidates = (
  term: AnyTerm,
  environment: Readonly<Environment>,
  facts: RelationFacts,
  analysis: Analysis,
  globalDomain: ReadonlyArray<unknown>,
): Array<unknown> => {
  if (hasBinding(environment, term)) {
    return [environment[term]]
  }

  const candidates = new Set<unknown>()

  const uses = analysis.relationUses.get(term) ?? []
  uses.forEach(use => {
    const relationFacts = facts.get(use.relationId) ?? []
    relationFacts.forEach(pair => {
      const value = use.side === "left" ? pair[0] : pair[1]
      candidates.add(value)
    })
  })

  if (candidates.size === 0) {
    globalDomain.forEach(value => candidates.add(value))
  }

  return [...candidates]
}

const sortAndChildren = (children: Array<Rule>): Array<Rule> => {
  const rank = (node: Rule): number => {
    switch (node.type) {
      case "relation":
        return 0
      case "eq-term":
      case "eq-value":
        return 1
      case "unary":
        return 2
      case "term":
        return 3
      case "ref":
        return 4
      case "select":
      case "distinct":
      case "memo":
      case "not":
      case "forall":
      case "and":
      case "or":
        return 5
      case "derives":
      case "given":
        return 4
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  return [...children].sort((a, b) => rank(a) - rank(b))
}

const createEnvironmentHasher = () => {
  const symbolIds = new Map<symbol, number>()
  let nextId = 1

  const symbolId = (value: symbol): number => {
    const existing = symbolIds.get(value)
    if (existing) {
      return existing
    }

    const id = nextId
    nextId += 1
    symbolIds.set(value, id)
    return id
  }

  return (environment: Readonly<Environment>): string => {
    const symbolParts = Object.getOwnPropertySymbols(environment)
      .sort((a, b) => symbolId(a) - symbolId(b))
      .map(key => `${symbolId(key)}:${JSON.stringify(environment[key])}`)

    const stringParts = Object.keys(environment)
      .sort()
      .map(key => `${key}:${JSON.stringify(environment[key])}`)

    return `${symbolParts.join("|")}||${stringParts.join("|")}`
  }
}

const dedupeEnvironments = (
  environments: Array<Environment>,
  hashEnvironment: (environment: Readonly<Environment>) => string,
): Array<Environment> => {
  const seen = new Set<string>()
  const output: Array<Environment> = []

  environments.forEach(environment => {
    const key = hashEnvironment(environment)
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    output.push(environment)
  })

  return output
}

type SolverState = {
  facts: RelationFacts
  analysis: Analysis
  definitions: Map<string, Rule>
  globalDomain: ReadonlyArray<unknown>
  hashEnvironment: (environment: Readonly<Environment>) => string
  memoCache: Map<string, Array<Environment>>
  proofCounters?: {
    selectApplied: number
    distinctApplied: number
    memoHits: number
    memoMisses: number
  }
}

const resolveExpressionOperand = (
  operand: Term<unknown> | AttributeAccessor<any, unknown>,
  environment: Readonly<Environment>,
): unknown => {
  if (!isAttributeAccessor(operand)) {
    return environment[operand]
  }

  const entity = environment[operand.term]
  if (
    entity === null ||
    entity === undefined ||
    typeof entity !== "object" ||
    Array.isArray(entity)
  ) {
    return undefined
  }

  return (entity as Record<string, unknown>)[operand.column]
}

const evaluatePredicateExpression = (
  expression: PredicateExpression,
  environment: Readonly<Environment>,
): boolean => {
  const resolve = (
    value: Term<unknown> | AttributeAccessor<any, unknown> | unknown,
  ): unknown => {
    if (isAttributeAccessor(value) || typeof value === "symbol") {
      return resolveExpressionOperand(
        value as Term<unknown> | AttributeAccessor<any, unknown>,
        environment,
      )
    }
    return value
  }

  switch (expression.operator) {
    case "eq":
      return Object.is(resolve(expression.left), resolve(expression.right))
    case "ne":
      return !Object.is(resolve(expression.left), resolve(expression.right))
    case "gt": {
      const left = resolve(expression.left)
      const right = resolve(expression.right)
      return left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined
        ? (left as number | string | Date) > (right as number | string | Date)
        : false
    }
    case "ge": {
      const left = resolve(expression.left)
      const right = resolve(expression.right)
      return left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined
        ? (left as number | string | Date) >= (right as number | string | Date)
        : false
    }
    case "lt": {
      const left = resolve(expression.left)
      const right = resolve(expression.right)
      return left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined
        ? (left as number | string | Date) < (right as number | string | Date)
        : false
    }
    case "le": {
      const left = resolve(expression.left)
      const right = resolve(expression.right)
      return left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined
        ? (left as number | string | Date) <= (right as number | string | Date)
        : false
    }
    case "one-of": {
      const left = resolve(expression.left)
      return expression.values.some(option => Object.is(left, option))
    }
    case "is-null": {
      const value = resolve(expression.operand)
      return value === null || value === undefined
    }
    case "is-not-null": {
      const value = resolve(expression.operand)
      return value !== null && value !== undefined
    }
    default: {
      const exhaustive: never = expression
      return exhaustive
    }
  }
}

const expandEnvironmentsForTerms = (
  environments: Array<Environment>,
  terms: Array<AnyTerm>,
  state: SolverState,
): Array<Environment> => {
  let expanded = environments

  terms.forEach(term => {
    const next: Array<Environment> = []
    expanded.forEach(environment => {
      const candidates = collectCandidates(
        term,
        environment,
        state.facts,
        state.analysis,
        state.globalDomain,
      )
      candidates.forEach(candidate => {
        next.push(
          hasBinding(environment, term)
            ? environment
            : bindValue(environment, term, candidate),
        )
      })
    })
    expanded = next
  })

  return expanded
}

const collectDefinitions = (rule: Rule): Map<string, Rule> => {
  const definitions = new Map<string, Rule>()

  const visit = (node: Rule): void => {
    switch (node.type) {
      case "memo": {
        const existing = definitions.get(node.name)
        if (existing && existing !== node.child) {
          throw new Error(`duplicate letRule definition for "${node.name}"`)
        }

        definitions.set(node.name, node.child)
        visit(node.child)
        return
      }
      case "and":
      case "or":
        node.children.forEach(visit)
        return
      case "not":
      case "distinct":
      case "select":
      case "forall":
        visit(node.child)
        return
      case "relation":
      case "unary":
      case "term":
      case "eq-term":
      case "eq-value":
      case "ref":
      case "derives":
      case "given":
        return
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  visit(rule)
  return definitions
}

type DefinitionEdge = {
  to: string
  negative: boolean
}

const buildDefinitionEdges = (
  definitions: Map<string, Rule>,
): Map<string, Array<DefinitionEdge>> => {
  const edges = new Map<string, Array<DefinitionEdge>>()

  const addEdge = (from: string, to: string, negative: boolean): void => {
    const existing = edges.get(from) ?? []
    existing.push({ to, negative })
    edges.set(from, existing)
  }

  for (const [name, child] of definitions.entries()) {
    const visit = (node: Rule, negativeDepth: number): void => {
      switch (node.type) {
        case "ref":
          addEdge(name, node.name, negativeDepth % 2 === 1)
          return
        case "and":
        case "or":
          node.children.forEach(item => visit(item, negativeDepth))
          return
        case "not":
          visit(node.child, negativeDepth + 1)
          return
        case "forall":
        case "select":
        case "distinct":
        case "memo":
          visit(node.child, negativeDepth)
          return
        case "relation":
        case "unary":
        case "term":
        case "eq-term":
        case "eq-value":
        case "derives":
        case "given":
          return
        default: {
          const exhaustive: never = node
          return exhaustive
        }
      }
    }

    visit(child, 0)
  }

  return edges
}

const validateRefNames = (rule: Rule, definitions: Map<string, Rule>): void => {
  const visit = (node: Rule): void => {
    switch (node.type) {
      case "ref":
        if (!definitions.has(node.name)) {
          throw new Error(`unknown ref "${node.name}"`)
        }
        return
      case "and":
      case "or":
        node.children.forEach(visit)
        return
      case "not":
      case "forall":
      case "select":
      case "distinct":
      case "memo":
        visit(node.child)
        return
      case "derives":
      case "given": {
        if (node.type === "derives") {
          return
        }
        visit(node.rule)
        visit(node.context)
        return
      }
      case "relation":
      case "unary":
      case "term":
      case "eq-term":
      case "eq-value":
        return
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  visit(rule)
}

const solveRule = async (
  rule: Rule,
  environments: Array<Environment>,
  state: SolverState,
): Promise<Array<Environment>> => {
  switch (rule.type) {
    case "ref": {
      const definition = state.definitions.get(rule.name)
      if (!definition) {
        throw new Error(`unknown ref "${rule.name}"`)
      }

      return solveRule(definition, environments, state)
    }

    case "relation": {
      const relationFacts = state.facts.get(rule.relationId) ?? []
      const output: Array<Environment> = []

      environments.forEach(environment => {
        const leftBound = hasBinding(environment, rule.left)
        const rightBound = hasBinding(environment, rule.right)
        const leftValue = environment[rule.left]
        const rightValue = environment[rule.right]

        relationFacts.forEach(pair => {
          const [candidateLeft, candidateRight] = pair

          if (leftBound && !Object.is(leftValue, candidateLeft)) {
            return
          }

          if (rightBound && !Object.is(rightValue, candidateRight)) {
            return
          }

          let next = environment

          if (!leftBound) {
            next = bindValue(next, rule.left, candidateLeft)
          }

          if (!rightBound) {
            next = bindValue(next, rule.right, candidateRight)
          }

          output.push(next)
        })
      })

      return output
    }

    case "unary": {
      const output: Array<Environment> = []

      for (const environment of environments) {
        if (isPredicateExpression(rule.predicate)) {
          const expression = rule.predicate
          const terms = getPredicateExpressionTerms(expression)
          const expanded = expandEnvironmentsForTerms(
            [environment],
            terms,
            state,
          )
          expanded.forEach(next => {
            if (evaluatePredicateExpression(expression, next)) {
              output.push(next)
            }
          })
          continue
        }

        const candidates = collectCandidates(
          rule.term,
          environment,
          state.facts,
          state.analysis,
          state.globalDomain,
        )
        for (const candidate of candidates) {
          const next = hasBinding(environment, rule.term)
            ? environment
            : bindValue(environment, rule.term, candidate)

          const passes = await rule.predicate(
            (next as Environment)[rule.term],
            next,
          )
          if (passes) {
            output.push(next)
          }
        }
      }

      return output
    }

    case "term": {
      const output: Array<Environment> = []

      environments.forEach(environment => {
        const candidates = collectCandidates(
          rule.term,
          environment,
          state.facts,
          state.analysis,
          state.globalDomain,
        )
        candidates.forEach(candidate => {
          output.push(
            hasBinding(environment, rule.term)
              ? environment
              : bindValue(environment, rule.term, candidate),
          )
        })
      })

      return output
    }

    case "eq-term": {
      const output: Array<Environment> = []

      environments.forEach(environment => {
        const leftBound = hasBinding(environment, rule.left)
        const rightBound = hasBinding(environment, rule.right)

        if (leftBound && rightBound) {
          if (Object.is(environment[rule.left], environment[rule.right])) {
            output.push(environment)
          }
          return
        }

        if (leftBound) {
          output.push(
            bindValue(environment, rule.right, environment[rule.left]),
          )
          return
        }

        if (rightBound) {
          output.push(
            bindValue(environment, rule.left, environment[rule.right]),
          )
          return
        }

        const candidates = collectCandidates(
          rule.left,
          environment,
          state.facts,
          state.analysis,
          state.globalDomain,
        )
        candidates.forEach(candidate => {
          let next = bindValue(environment, rule.left, candidate)
          next = bindValue(next, rule.right, candidate)
          output.push(next)
        })
      })

      return output
    }

    case "eq-value": {
      const output: Array<Environment> = []

      environments.forEach(environment => {
        if (!hasBinding(environment, rule.term)) {
          output.push(bindValue(environment, rule.term, rule.value))
          return
        }

        if (Object.is(environment[rule.term], rule.value)) {
          output.push(environment)
        }
      })

      return output
    }

    case "and": {
      let current = environments
      const ordered = sortAndChildren(rule.children)

      for (const child of ordered) {
        if (current.length === 0) {
          return current
        }

        current = await solveRule(child, current, state)
      }

      return current
    }

    case "or": {
      const branches = await Promise.all(
        rule.children.map(child => solveRule(child, environments, state)),
      )
      return dedupeEnvironments(branches.flat(), state.hashEnvironment)
    }

    case "not": {
      const output: Array<Environment> = []

      for (const environment of environments) {
        const branch = await solveRule(rule.child, [environment], state)
        if (branch.length === 0) {
          output.push(environment)
        }
      }

      return output
    }

    case "given": {
      const contextEnvironments = await solveRule(
        rule.context,
        environments,
        state,
      )
      return solveRule(rule.rule, contextEnvironments, state)
    }

    case "forall": {
      const output: Array<Environment> = []

      for (const environment of environments) {
        const candidates = collectCandidates(
          rule.term,
          environment,
          state.facts,
          state.analysis,
          state.globalDomain,
        )

        if (candidates.length === 0) {
          output.push(environment)
          continue
        }

        let allPass = true

        for (const candidate of candidates) {
          const next = bindValue(environment, rule.term, candidate)
          const branch = await solveRule(rule.child, [next], state)
          if (branch.length === 0) {
            allPass = false
            break
          }
        }

        if (allPass) {
          output.push(environment)
        }
      }

      return output
    }

    case "select": {
      const branch = await solveRule(rule.child, environments, state)
      if (state.proofCounters) {
        state.proofCounters.selectApplied += 1
      }

      return branch.map(environment => {
        const projected: Environment = {}

        rule.terms.forEach(term => {
          if (hasBinding(environment, term)) {
            projected[term] = environment[term]
          }
        })

        Object.keys(environment).forEach(key => {
          projected[key] = environment[key]
        })

        return projected
      })
    }

    case "distinct": {
      if (state.proofCounters) {
        state.proofCounters.distinctApplied += 1
      }
      const branch = await solveRule(rule.child, environments, state)
      return dedupeEnvironments(branch, state.hashEnvironment)
    }

    case "memo": {
      const output: Array<Environment> = []

      for (const environment of environments) {
        const key = `${rule.name}::${state.hashEnvironment(environment)}`
        const cached = state.memoCache.get(key)
        if (cached) {
          if (state.proofCounters) {
            state.proofCounters.memoHits += 1
          }
          output.push(...cached)
          continue
        }

        if (state.proofCounters) {
          state.proofCounters.memoMisses += 1
        }
        const branch = await solveRule(rule.child, [environment], state)
        state.memoCache.set(key, branch)
        output.push(...branch)
      }

      return output
    }

    case "derives": {
      const output: Array<Environment> = []

      environments.forEach(environment => {
        const entityBound = hasBinding(environment, rule.entity)
        const fromBound = hasBinding(environment, rule.from)
        const entityValue = environment[rule.entity]
        const fromValue = environment[rule.from]

        if (entityBound && fromBound) {
          if (Object.is(entityValue, fromValue)) {
            output.push(environment)
          }
          return
        }

        if (entityBound) {
          output.push(bindValue(environment, rule.from, entityValue))
          return
        }

        if (fromBound) {
          output.push(bindValue(environment, rule.entity, fromValue))
          return
        }

        const candidates = collectCandidates(
          rule.entity,
          environment,
          state.facts,
          state.analysis,
          state.globalDomain,
        )
        candidates.forEach(candidate => {
          let next = bindValue(environment, rule.entity, candidate)
          next = bindValue(next, rule.from, candidate)
          output.push(next)
        })
      })

      return output
    }

    case "given": {
      const contextEnvironments = await solveRule(
        rule.context,
        environments,
        state,
      )
      return solveRule(rule.rule, contextEnvironments, state)
    }

    default: {
      const exhaustive: never = rule
      return exhaustive
    }
  }
}

const validateStratifiedNegationInternal = (rule: Rule): void => {
  const definitions = collectDefinitions(rule)
  validateRefNames(rule, definitions)
  const edges = buildDefinitionEdges(definitions)

  const visited = new Set<string>()

  const dfs = (
    node: string,
    stack: Array<string>,
    negPath: Array<boolean>,
  ): void => {
    const indexInStack = stack.indexOf(node)
    if (indexInStack >= 0) {
      let hasNegativeEdge = false
      for (let i = indexInStack; i < negPath.length; i += 1) {
        hasNegativeEdge = hasNegativeEdge !== negPath[i]
      }

      if (hasNegativeEdge) {
        throw new Error(
          `non-stratified negation: negative recursive dependency detected at "${node}"`,
        )
      }

      throw new Error(
        `recursive rule references are not supported yet (cycle at "${node}")`,
      )
    }

    if (visited.has(node)) {
      return
    }

    const nextStack = [...stack, node]
    const outgoing = edges.get(node) ?? []
    for (const edge of outgoing) {
      dfs(edge.to, nextStack, [...negPath, edge.negative])
    }

    visited.add(node)
  }

  for (const name of definitions.keys()) {
    dfs(name, [], [])
  }
}

export const validateStratifiedNegation = (rule: Rule): void => {
  validateStratifiedNegationInternal(rule)
}

export interface InMemoryRelationFacts<Left, Right> {
  relation: Relation<Left, Right>
  pairs: Array<readonly [Left, Right]>
  rows?: Array<InMemoryRelationRow<Left, Right>>
  predicates?: ReadonlyArray<SourcePredicate>
  orderings?: ReadonlyArray<SourceOrdering>
}

export interface InMemoryRelationRow<Left, Right> {
  left: Left
  right: Right
  columns?: Readonly<Record<string, unknown>>
}

export interface InMemoryAdapterOptions {
  relations: Array<InMemoryRelationFacts<any, any>>
  domain?: ReadonlyArray<unknown>
}

const buildFacts = (
  relations: Array<InMemoryRelationFacts<any, any>>,
): RelationFacts => {
  const findOrderingForColumn = (
    column: string,
    orderings?: ReadonlyArray<SourceOrdering>,
  ): SourceOrdering | undefined => {
    return orderings?.find(ordering => ordering.column === column)
  }

  const readRowColumnValue = <Left, Right>(
    row: InMemoryRelationRow<Left, Right>,
    column: string,
  ): unknown => {
    if (column === "left") {
      return row.left
    }

    if (column === "right") {
      return row.right
    }

    return row.columns?.[column]
  }

  const toComparableValue = (
    value: unknown,
    ordering?: SourceOrdering,
  ): unknown => {
    if (!ordering) {
      return value
    }

    if (typeof value !== "string") {
      return null
    }

    return ordering.order[value] ?? null
  }

  const rowMatchesPredicate = (
    row: InMemoryRelationRow<any, any>,
    predicate: SourcePredicate,
    orderings?: ReadonlyArray<SourceOrdering>,
  ): boolean => {
    const rawValue = readRowColumnValue(row, predicate.column)
    if (rawValue === undefined) {
      throw new Error(
        `in-memory relation predicate references unknown column "${predicate.column}"`,
      )
    }

    if (predicate.op === "in") {
      return predicate.values.some(value => Object.is(rawValue, value))
    }

    if (predicate.op === "eq") {
      return Object.is(rawValue, predicate.value)
    }

    const ordering = findOrderingForColumn(predicate.column, orderings)
    const left = toComparableValue(rawValue, ordering)
    const right = toComparableValue(predicate.value, ordering)

    if (
      left === null ||
      left === undefined ||
      right === null ||
      right === undefined
    ) {
      return false
    }

    if (predicate.op === "gt") {
      return (
        (left as number | string | Date) > (right as number | string | Date)
      )
    }

    if (predicate.op === "ge") {
      return (
        (left as number | string | Date) >= (right as number | string | Date)
      )
    }

    if (predicate.op === "lt") {
      return (
        (left as number | string | Date) < (right as number | string | Date)
      )
    }

    if (predicate.op === "le") {
      return (
        (left as number | string | Date) <= (right as number | string | Date)
      )
    }

    return false
  }

  const output = new Map<symbol, Array<FactPair>>()

  relations.forEach(entry => {
    const rows =
      entry.rows ??
      entry.pairs.map(pair => ({
        left: pair[0],
        right: pair[1],
      }))
    const filteredRows =
      entry.predicates && entry.predicates.length > 0
        ? rows.filter(row =>
            entry.predicates?.every(predicate =>
              rowMatchesPredicate(row, predicate, entry.orderings),
            ),
          )
        : rows
    const filteredPairs = filteredRows.map(
      row => [row.left, row.right] as readonly [unknown, unknown],
    )
    const existing = output.get(entry.relation.id) ?? []
    output.set(entry.relation.id, [...existing, ...filteredPairs])
  })

  return output
}

export const createInMemoryAdapter = <
  Env extends Environment = Environment,
  EvaluatorContext = unknown,
>(
  options: InMemoryAdapterOptions,
): EvaluatorAdapter<Env, EvaluatorContext> => {
  const facts = buildFacts(options.relations)
  const globalDomain = options.domain ?? []

  return {
    async evaluate(rule, environment) {
      validateStratifiedNegationInternal(rule)
      const analysis = analyzeRule(rule)
      const definitions = collectDefinitions(rule)
      const hashEnvironment = createEnvironmentHasher()

      const state: SolverState = {
        facts,
        analysis,
        definitions,
        globalDomain,
        hashEnvironment,
        memoCache: new Map(),
      }

      const matches = await solveRule(rule, [environment], state)
      return matches.length > 0
    },
    async evaluateWithProof(rule, environment) {
      validateStratifiedNegationInternal(rule)
      const analysis = analyzeRule(rule)
      const definitions = collectDefinitions(rule)
      const hashEnvironment = createEnvironmentHasher()
      const counters = {
        selectApplied: 0,
        distinctApplied: 0,
        memoHits: 0,
        memoMisses: 0,
      }

      const state: SolverState = {
        facts,
        analysis,
        definitions,
        globalDomain,
        hashEnvironment,
        memoCache: new Map(),
        proofCounters: counters,
      }

      const matches = await solveRule(rule, [environment], state)

      const proof: EvaluationProof = {
        ok: matches.length > 0,
        rule,
        details: {
          ...buildEvaluationProofDetails(rule, matches.length > 0),
          matchCount: matches.length,
          ...counters,
        },
      }

      return proof
    },
    async filter(rule, options) {
      validateStratifiedNegationInternal(rule)
      const analysis = analyzeRule(rule)
      const definitions = collectDefinitions(rule)
      const hashEnvironment = createEnvironmentHasher()

      const state: SolverState = {
        facts,
        analysis,
        definitions,
        globalDomain,
        hashEnvironment,
        memoCache: new Map(),
      }

      const term = options.term as unknown as AnyTerm
      const baseEnvironment = options.environment
      const providedCandidates = options.candidates ?? []
      const candidates =
        options.candidates === undefined
          ? collectCandidates(
              term,
              baseEnvironment,
              facts,
              analysis,
              globalDomain,
            )
          : [...providedCandidates]
      const uniqueCandidates = [...new Set(candidates)]
      const allowed: Array<unknown> = []

      for (const candidate of uniqueCandidates) {
        const scopedEnvironment = bindValue(baseEnvironment, term, candidate)
        const matches = await solveRule(rule, [scopedEnvironment], state)
        if (matches.length > 0) {
          allowed.push(candidate)
        }
      }

      return allowed as ReadonlyArray<any>
    },
  }
}

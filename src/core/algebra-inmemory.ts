import {
  type Environment,
  type EvaluationProof,
  type EvaluatorAdapter,
  type Relation,
  type Rule,
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

const collectDefinitions = (rule: Rule): Map<string, Rule> => {
  const definitions = new Map<string, Rule>()

  const visit = (node: Rule): void => {
    switch (node.type) {
      case "memo": {
        const existing = definitions.get(node.name)
        if (existing && existing !== node.child) {
          throw new Error(`duplicate memo definition for "${node.name}"`)
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
}

export interface InMemoryAdapterOptions {
  relations: Array<InMemoryRelationFacts<any, any>>
  domain?: ReadonlyArray<unknown>
}

const buildFacts = (
  relations: Array<InMemoryRelationFacts<any, any>>,
): RelationFacts => {
  const output = new Map<symbol, Array<FactPair>>()

  relations.forEach(entry => {
    const existing = output.get(entry.relation.id) ?? []
    output.set(entry.relation.id, [...existing, ...entry.pairs])
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
          matchCount: matches.length,
          ...counters,
        },
      }

      return proof
    },
  }
}

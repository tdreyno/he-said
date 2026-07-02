import {
  type AttributeAccessor,
  type Environment,
  type EvaluationFailingNode,
  type EvaluationProof,
  type EvaluatorAdapter,
  type EvaluatorPrepareOptions,
  isAttributeAccessor,
  isPredicateExpression,
  type PredicateExpression,
  type PreparedEvaluatorAdapter,
  type Relation,
  type Rule,
  type SourceComparisonOperator,
  type SourceOrdering,
  type SourcePredicate,
  type Term,
} from "./algebra"

type PostgresSourceFilter = {
  sql: string
  params?: ReadonlyArray<unknown>
}

const runPreparedHydration = async (
  source: PostgresRelationSource,
  queryExecutor: PostgresQueryExecutor,
): Promise<ReadonlyArray<readonly [unknown, unknown]>> => {
  const alias = "preload_src"
  const selectSql = [
    `SELECT ${quoteIdentifier(alias)}.${quoteIdentifier(source.leftColumn)} AS left_value,`,
    `${quoteIdentifier(alias)}.${quoteIdentifier(source.rightColumn)} AS right_value`,
    `FROM ${quoteQualifiedIdentifier(source.table)} ${quoteIdentifier(alias)}`,
  ]

  const params: Array<unknown> = []
  const whereClauses: Array<string> = []
  source.staticFilters?.forEach(filter => {
    whereClauses.push(bindStaticFilterSql({ params }, filter, alias))
  })

  const whereSql =
    whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : ""
  const queryResult = await queryExecutor.query<{
    left_value: unknown
    right_value: unknown
  }>(`${selectSql.join(" ")}${whereSql}`, params)

  return queryResult.rows.map(row => [row.left_value, row.right_value] as const)
}
export type PostgresSourceComparisonOperator = SourceComparisonOperator
export type PostgresSourcePredicate = SourcePredicate
export type PostgresSourceOrdering = SourceOrdering

type PostgresSuggestedIndex = {
  columns: ReadonlyArray<string>
  where?: string
}

type PostgresRelationSourceBase = {
  table: string
  leftColumn: string
  rightColumn: string
  staticFilters?: ReadonlyArray<PostgresSourceFilter>
  predicates?: ReadonlyArray<PostgresSourcePredicate>
  orderings?: ReadonlyArray<PostgresSourceOrdering>
  suggestedIndexes?: ReadonlyArray<PostgresSuggestedIndex>
}

export type PostgresEdgeRelationSource = PostgresRelationSourceBase & {
  kind?: "edge"
}

export type PostgresJoinTableRelationSource = PostgresRelationSourceBase & {
  kind?: "join-table"
  metadataColumns?: Readonly<Record<string, string>>
  recommendedView?: string
}

export type PostgresRelationSource =
  | PostgresEdgeRelationSource
  | PostgresJoinTableRelationSource
type PostgresRelationSourceKind = NonNullable<PostgresRelationSource["kind"]>

export interface PostgresRelationMapping<Left, Right> {
  relation: Relation<Left, Right>
  source: PostgresRelationSource
}

export interface PostgresQueryResult<Row> {
  readonly rows: ReadonlyArray<Row>
}

export interface PostgresQueryExecutor {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<PostgresQueryResult<Row>>
}

export type PostgresTermEncoder<T> = (value: T) => unknown

export interface PostgresTermEncoding<T> {
  term: Term<T>
  encode: PostgresTermEncoder<T>
}

type PostgresTermDomainSourceBase = {
  table: string
  valueColumn: string
  columns?: Readonly<Record<string, string>>
  staticFilters?: ReadonlyArray<PostgresSourceFilter>
  predicates?: ReadonlyArray<PostgresSourcePredicate>
  orderings?: ReadonlyArray<PostgresSourceOrdering>
}

export type PostgresTermDomainSource<T> = PostgresTermDomainSourceBase & {
  term: Term<T>
}

export interface PostgresProofDiagnostic {
  readonly level: "info" | "warning"
  readonly code: string
  readonly message: string
  readonly recommendation?: string
}

export interface PlannedPostgresRule {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
  readonly diagnostics: ReadonlyArray<PostgresProofDiagnostic>
  readonly selectApplied: number
  readonly distinctApplied: number
  readonly sources: ReadonlyArray<{
    relationId: symbol
    kind: PostgresRelationSourceKind
    table: string
  }>
}

export interface PostgresTermSqlBinding<T> {
  term: Term<T>
  sql: string
}

export interface PlannedPostgresPredicate {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
  readonly diagnostics: ReadonlyArray<PostgresProofDiagnostic>
  readonly selectApplied: number
  readonly distinctApplied: number
  readonly sources: ReadonlyArray<{
    relationId: symbol
    kind: PostgresRelationSourceKind
    table: string
  }>
}

export interface PostgresAdapterOptions<
  Env extends Environment = Environment,
  EvaluatorContext = unknown,
> {
  relationMappings: ReadonlyArray<PostgresRelationMapping<any, any>>
  termDomains?: ReadonlyArray<PostgresTermDomainSource<any>>
  termEncodings?: ReadonlyArray<PostgresTermEncoding<any>>
  queryExecutor: PostgresQueryExecutor
  getEvaluatorContext?: (
    evaluatorContext: EvaluatorContext,
    environment: Readonly<Env>,
  ) => Readonly<Record<string, unknown>>
  explainQuery?: boolean
  includeFailingNodeSql?: boolean
}

type PreparedPostgresRelationSource = {
  kind: "prepared"
  pairs: ReadonlyArray<readonly [unknown, unknown]>
}

type PlannerRelationSource =
  | PostgresRelationSource
  | PreparedPostgresRelationSource

type PlannerRelationMapping = {
  relation: Relation<any, any>
  source: PlannerRelationSource
}

type PlannerState = {
  relationMappings: Map<symbol, PlannerRelationSource>
  termDomains: Map<symbol, PostgresTermDomainSource<any>>
  termAttributeAliases: Map<symbol, string>
  termEncodings: Map<symbol, PostgresTermEncoder<any>>
  definitions: Map<string, Rule>
  termIds: Map<symbol, string>
  nextAlias: number
  params: Array<unknown>
  diagnostics: Array<PostgresProofDiagnostic>
  sources: Array<{
    relationId: symbol
    kind: PostgresRelationSourceKind
    table: string
  }>
  selectApplied: number
  distinctApplied: number
}

type QueryBuilder = {
  columns: Map<symbol, string>
  fromClauses: Array<string>
  whereClauses: Array<string>
}

type ParamState = {
  params: Array<unknown>
}

const quoteIdentifier = (value: string): string => {
  return `"${value.split('"').join('""')}"`
}

const quoteQualifiedIdentifier = (value: string): string => {
  return value.split(".").map(quoteIdentifier).join(".")
}

const nextAlias = (state: PlannerState, prefix: string): string => {
  state.nextAlias += 1
  return `${prefix}${state.nextAlias}`
}

const nextParam = (state: ParamState, value: unknown): string => {
  state.params.push(value)
  return `$${state.params.length}`
}

const isSqlPrimitive = (value: unknown): boolean => {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value instanceof Date
  )
}

const encodeTermValue = (
  state: PlannerState,
  term: symbol,
  value: unknown,
): unknown => {
  const encoder = state.termEncodings.get(term)
  if (encoder) {
    return encoder(value)
  }

  if (isSqlPrimitive(value)) {
    return value
  }

  throw new Error(
    "postgres adapter requires a term encoder for bound object values; configure termEncodings for this term",
  )
}

const termKey = (state: PlannerState, term: symbol): string => {
  const existing = state.termIds.get(term)
  if (existing) {
    return existing
  }

  const value = `term_${state.termIds.size + 1}`
  state.termIds.set(term, value)
  return value
}

const applyFilterAlias = (sql: string, alias: string): string => {
  return sql.split("{{source}}").join(alias)
}

const staticFilterParamPattern = /\$([1-9][0-9]*)/g

const parseStaticFilterParamIndexes = (sql: string): Array<number> => {
  const output: Array<number> = []
  let match = staticFilterParamPattern.exec(sql)
  while (match) {
    output.push(Number(match[1]))
    match = staticFilterParamPattern.exec(sql)
  }
  staticFilterParamPattern.lastIndex = 0
  return output
}

const bindStaticFilterSql = (
  state: ParamState,
  filter: PostgresSourceFilter,
  alias: string,
): string => {
  const aliasedSql = applyFilterAlias(filter.sql, quoteIdentifier(alias))
  const referencedIndexes = parseStaticFilterParamIndexes(aliasedSql)
  const paramCount = filter.params?.length ?? 0
  const hasPlaceholders = referencedIndexes.length > 0

  if (paramCount === 0) {
    if (hasPlaceholders) {
      throw new Error(
        "postgres adapter staticFilters.sql uses positional parameters but no staticFilters.params were provided",
      )
    }
    return aliasedSql
  }

  if (!hasPlaceholders) {
    throw new Error(
      "postgres adapter staticFilters.params were provided but staticFilters.sql has no positional parameters",
    )
  }

  const highestReferenced = Math.max(...referencedIndexes)
  if (highestReferenced !== paramCount) {
    throw new Error(
      "postgres adapter staticFilters.sql positional parameters must be contiguous and match staticFilters.params length",
    )
  }

  const offset = state.params.length
  const reboundSql = aliasedSql.replace(
    staticFilterParamPattern,
    (_token, index) => {
      return `$${Number(index) + offset}`
    },
  )
  staticFilterParamPattern.lastIndex = 0
  filter.params?.forEach(value => {
    nextParam(state, value)
  })

  return reboundSql
}

const findOrderingForColumn = (
  column: string,
  orderings?: ReadonlyArray<PostgresSourceOrdering>,
): PostgresSourceOrdering | undefined => {
  return orderings?.find(ordering => ordering.column === column)
}

const renderOrderedColumnSql = (
  columnSql: string,
  ordering: PostgresSourceOrdering,
): string => {
  const quoteLiteral = (value: string): string => {
    return `'${value.split("'").join("''")}'`
  }
  const clauses = Object.entries(ordering.order)
    .map(([value, rank]) => `WHEN ${quoteLiteral(value)} THEN ${rank}`)
    .join(" ")

  return `(CASE ${columnSql} ${clauses} ELSE NULL END)`
}

const resolvePredicateValue = (
  predicate: { column: string; value: unknown },
  ordering?: PostgresSourceOrdering,
): unknown => {
  if (ordering) {
    if (typeof predicate.value !== "string") {
      throw new Error(
        `ordered comparison predicate for "${predicate.column}" requires a string value`,
      )
    }

    return ordering.order[predicate.value] ?? null
  }

  return predicate.value
}
const sortAndChildren = (children: ReadonlyArray<Rule>): Array<Rule> => {
  const rank = (node: Rule): number => {
    switch (node.type) {
      case "relation":
        return 0
      case "eq-term":
      case "eq-value":
      case "derives":
      case "exists":
        return 1
      case "ref":
      case "select":
      case "distinct":
      case "memo":
      case "given":
        return 2
      case "term":
      case "unary":
      case "or":
      case "not":
      case "forall":
      case "and":
        return 3
      default: {
        const exhaustive: never = node
        return exhaustive
      }
    }
  }

  return [...children].sort((left, right) => rank(left) - rank(right))
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
      case "exists":
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

const resolveSourceKind = (
  source: PostgresRelationSource,
): PostgresRelationSourceKind => {
  if (source.kind) {
    return source.kind
  }

  if (
    ("metadataColumns" in source && source.metadataColumns) ||
    ("recommendedView" in source && source.recommendedView)
  ) {
    return "join-table"
  }

  return "edge"
}

const isJoinTableSource = (
  source: PostgresRelationSource,
): source is PostgresJoinTableRelationSource => {
  return resolveSourceKind(source) === "join-table"
}

const addSourceDiagnostics = (
  state: PlannerState,
  source: PlannerRelationSource,
): void => {
  if (source.kind === "prepared" || !isJoinTableSource(source)) {
    return
  }

  const compositeIndex = `(${quoteIdentifier(source.leftColumn)}, ${quoteIdentifier(source.rightColumn)})`
  const hasSourceFilters =
    (source.staticFilters?.length ?? 0) > 0 ||
    (source.predicates?.length ?? 0) > 0
  const missingIndexRecommendation = hasSourceFilters
    ? `Consider a partial index on ${quoteQualifiedIdentifier(source.table)} ${compositeIndex} with the join-table filter predicate.`
    : `Consider a composite index on ${quoteQualifiedIdentifier(source.table)} ${compositeIndex}.`

  if (!source.suggestedIndexes || source.suggestedIndexes.length === 0) {
    state.diagnostics.push({
      level: "warning",
      code: "missing-join-table-index-hint",
      message: `Join-table relation ${quoteQualifiedIdentifier(source.table)} has no suggested indexes configured.`,
      recommendation: missingIndexRecommendation,
    })
  }

  if (
    source.recommendedView &&
    (hasSourceFilters || Object.keys(source.metadataColumns ?? {}).length > 0)
  ) {
    state.diagnostics.push({
      level: "info",
      code: "consider-join-table-view",
      message: `Join-table relation ${quoteQualifiedIdentifier(source.table)} carries reusable filters or metadata.`,
      recommendation: `Consider exposing ${quoteQualifiedIdentifier(source.recommendedView)} as a stable view for this relation source.`,
    })
  }
}

const createBuilder = (): QueryBuilder => ({
  columns: new Map(),
  fromClauses: [],
  whereClauses: [],
})

const appendTerm = (
  rule: Extract<Rule, { type: "term" }>,
  builder: QueryBuilder,
): QueryBuilder => {
  if (builder.columns.has(rule.term)) {
    return builder
  }

  throw new Error(
    "postgres adapter does not support unconstrained term nodes yet; anchor the term through a relation or equality first",
  )
}

const compileTermExistenceSql = (
  term: symbol,
  boundValueSql: string,
  state: PlannerState,
): string => {
  const explicitDomain = state.termDomains.get(term)
  if (!explicitDomain) {
    throw new Error(
      "postgres adapter exists(term) requires a termDomains mapping for the referenced term",
    )
  }

  const alias = nextAlias(state, "exists")
  const builder = createBuilder()
  const valueSql = `${quoteIdentifier(alias)}.${quoteIdentifier(explicitDomain.valueColumn)}`
  builder.fromClauses.push(
    `FROM ${quoteQualifiedIdentifier(explicitDomain.table)} ${quoteIdentifier(alias)}`,
  )
  builder.whereClauses.push(`${valueSql} IS NOT DISTINCT FROM ${boundValueSql}`)
  appendStaticFilters(builder, state, alias, explicitDomain.staticFilters)
  appendSourcePredicates(
    builder,
    state,
    alias,
    explicitDomain.predicates,
    explicitDomain.orderings,
  )

  return renderInnerSql(builder)
}

const cloneColumns = (
  columns: ReadonlyMap<symbol, string>,
): Map<symbol, string> => {
  return new Map(columns)
}

const appendRelation = (
  rule: Extract<Rule, { type: "relation" }>,
  builder: QueryBuilder,
  state: PlannerState,
): QueryBuilder => {
  const source = state.relationMappings.get(rule.relationId)
  if (!source) {
    throw new Error("postgres adapter is missing a relation mapping")
  }

  const alias = nextAlias(state, "rel")
  if (source.kind === "prepared") {
    const preparedLeftColumn = "left_value"
    const preparedRightColumn = "right_value"
    const tableSql =
      source.pairs.length === 0
        ? `(SELECT NULL AS ${quoteIdentifier(preparedLeftColumn)}, NULL AS ${quoteIdentifier(preparedRightColumn)} WHERE FALSE) ${quoteIdentifier(alias)}`
        : `(VALUES ${source.pairs
            .map(([leftValue, rightValue]) => {
              const leftParam = nextParam(state, leftValue)
              const rightParam = nextParam(state, rightValue)
              return `(${leftParam}, ${rightParam})`
            })
            .join(
              ", ",
            )}) ${quoteIdentifier(alias)}(${quoteIdentifier(preparedLeftColumn)}, ${quoteIdentifier(preparedRightColumn)})`

    builder.fromClauses.push(
      builder.fromClauses.length === 0
        ? `FROM ${tableSql}`
        : `JOIN ${tableSql} ON TRUE`,
    )

    const leftSql = `${quoteIdentifier(alias)}.${quoteIdentifier(preparedLeftColumn)}`
    const rightSql = `${quoteIdentifier(alias)}.${quoteIdentifier(preparedRightColumn)}`
    const existingLeft = builder.columns.get(rule.left)
    const existingRight = builder.columns.get(rule.right)

    if (existingLeft) {
      builder.whereClauses.push(
        `${existingLeft} IS NOT DISTINCT FROM ${leftSql}`,
      )
    } else {
      builder.columns.set(rule.left, leftSql)
    }

    if (existingRight) {
      builder.whereClauses.push(
        `${existingRight} IS NOT DISTINCT FROM ${rightSql}`,
      )
    } else {
      builder.columns.set(rule.right, rightSql)
    }

    return builder
  }

  const tableSql = `${quoteQualifiedIdentifier(source.table)} ${quoteIdentifier(alias)}`

  builder.fromClauses.push(
    builder.fromClauses.length === 0
      ? `FROM ${tableSql}`
      : `JOIN ${tableSql} ON TRUE`,
  )

  const leftSql = `${quoteIdentifier(alias)}.${quoteIdentifier(source.leftColumn)}`
  const rightSql = `${quoteIdentifier(alias)}.${quoteIdentifier(source.rightColumn)}`
  const existingLeft = builder.columns.get(rule.left)
  const existingRight = builder.columns.get(rule.right)

  if (existingLeft) {
    builder.whereClauses.push(`${existingLeft} IS NOT DISTINCT FROM ${leftSql}`)
  } else {
    builder.columns.set(rule.left, leftSql)
  }

  if (existingRight) {
    builder.whereClauses.push(
      `${existingRight} IS NOT DISTINCT FROM ${rightSql}`,
    )
  } else {
    builder.columns.set(rule.right, rightSql)
  }

  appendStaticFilters(builder, state, alias, source.staticFilters)
  appendSourcePredicates(
    builder,
    state,
    alias,
    source.predicates,
    source.orderings,
  )

  state.sources.push({
    relationId: rule.relationId,
    kind: resolveSourceKind(source),
    table: source.table,
  })
  addSourceDiagnostics(state, source)

  return builder
}

const appendEqValue = (
  rule: Extract<Rule, { type: "eq-value" }>,
  builder: QueryBuilder,
  state: PlannerState,
): QueryBuilder => {
  const existing = builder.columns.get(rule.term)

  if (existing) {
    const encodedValue = encodeTermValue(state, rule.term, rule.value)
    const param = nextParam(state, encodedValue)
    builder.whereClauses.push(`${existing} IS NOT DISTINCT FROM ${param}`)
    return builder
  }

  builder.whereClauses.push("FALSE")
  return builder
}

const appendEqTerm = (
  rule: Extract<Rule, { type: "eq-term" }>,
  builder: QueryBuilder,
): QueryBuilder => {
  const left = builder.columns.get(rule.left)
  const right = builder.columns.get(rule.right)

  if (left && right) {
    builder.whereClauses.push(`${left} IS NOT DISTINCT FROM ${right}`)
    return builder
  }

  if (left) {
    builder.columns.set(rule.right, left)
    return builder
  }

  if (right) {
    builder.columns.set(rule.left, right)
    return builder
  }

  throw new Error(
    "postgres adapter cannot solve eq(termA, termB) when neither side is anchored by a relation or bound environment yet",
  )
}

const ensureSqlLiteral = (value: unknown): unknown => {
  if (isSqlPrimitive(value)) {
    return value
  }

  throw new Error(
    "postgres adapter only supports SQL primitive literal values in predicate expressions",
  )
}

const resolveOperandSql = (
  operand: Term<unknown> | AttributeAccessor<any, unknown>,
  builder: QueryBuilder,
  state: PlannerState,
): string => {
  if (!isAttributeAccessor(operand)) {
    const termSql = builder.columns.get(operand)
    if (!termSql) {
      throw new Error(
        "postgres adapter cannot compile predicate expression when a term operand is not anchored by relation or environment binding",
      )
    }
    return termSql
  }

  const termRoot = operand.term
  const boundTermSql = builder.columns.get(termRoot)
  if (!boundTermSql) {
    throw new Error(
      "postgres adapter cannot compile attribute predicate when the owning term is not anchored by relation or environment binding",
    )
  }

  const attributeDomain = state.termDomains.get(termRoot)
  if (!attributeDomain) {
    throw new Error(
      "postgres adapter is missing a termDomains mapping for an attr(...) predicate term",
    )
  }

  let alias = state.termAttributeAliases.get(termRoot)
  if (!alias) {
    alias = nextAlias(state, "src")
    const tableSql = `${quoteQualifiedIdentifier(attributeDomain.table)} ${quoteIdentifier(alias)}`
    builder.fromClauses.push(
      builder.fromClauses.length === 0
        ? `FROM ${tableSql}`
        : `JOIN ${tableSql} ON TRUE`,
    )
    const idSql = `${quoteIdentifier(alias)}.${quoteIdentifier(attributeDomain.valueColumn)}`
    builder.whereClauses.push(`${idSql} IS NOT DISTINCT FROM ${boundTermSql}`)
    appendStaticFilters(builder, state, alias, attributeDomain.staticFilters)
    state.termAttributeAliases.set(termRoot, alias)
  }

  const mappedColumn = attributeDomain.columns?.[operand.column]
  if (!mappedColumn) {
    throw new Error(
      `postgres adapter is missing an attr(...) column mapping in termDomains for "${operand.column}"`,
    )
  }

  return `${quoteIdentifier(alias)}.${quoteIdentifier(mappedColumn)}`
}

const resolveRightOperandSql = (
  right: Term<unknown> | AttributeAccessor<any, unknown> | unknown,
  builder: QueryBuilder,
  state: PlannerState,
): string => {
  if (isAttributeAccessor(right) || typeof right === "symbol") {
    return resolveOperandSql(
      right as Term<unknown> | AttributeAccessor<any, unknown>,
      builder,
      state,
    )
  }

  const encoded = ensureSqlLiteral(right)
  return nextParam(state, encoded)
}

const appendPredicateExpression = (
  expression: PredicateExpression,
  builder: QueryBuilder,
  state: PlannerState,
): QueryBuilder => {
  switch (expression.operator) {
    case "eq": {
      const leftSql = resolveOperandSql(expression.left, builder, state)
      const rightSql = resolveRightOperandSql(expression.right, builder, state)
      builder.whereClauses.push(`${leftSql} IS NOT DISTINCT FROM ${rightSql}`)
      return builder
    }
    case "ne": {
      const leftSql = resolveOperandSql(expression.left, builder, state)
      const rightSql = resolveRightOperandSql(expression.right, builder, state)
      builder.whereClauses.push(
        `NOT (${leftSql} IS NOT DISTINCT FROM ${rightSql})`,
      )
      return builder
    }
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      const leftSql = resolveOperandSql(expression.left, builder, state)
      const rightSql = resolveRightOperandSql(expression.right, builder, state)
      const operator =
        expression.operator === "gt"
          ? ">"
          : expression.operator === "ge"
            ? ">="
            : expression.operator === "lt"
              ? "<"
              : "<="
      builder.whereClauses.push(`${leftSql} ${operator} ${rightSql}`)
      return builder
    }
    case "one-of": {
      const leftSql = resolveOperandSql(expression.left, builder, state)
      if (expression.values.length === 0) {
        builder.whereClauses.push("FALSE")
        return builder
      }

      const parts = expression.values.map(value => {
        const param = nextParam(state, ensureSqlLiteral(value))
        return `${leftSql} IS NOT DISTINCT FROM ${param}`
      })
      builder.whereClauses.push(`(${parts.join(" OR ")})`)
      return builder
    }
    case "is-null": {
      const operandSql = resolveOperandSql(expression.operand, builder, state)
      builder.whereClauses.push(`${operandSql} IS NULL`)
      return builder
    }
    case "is-not-null": {
      const operandSql = resolveOperandSql(expression.operand, builder, state)
      builder.whereClauses.push(`${operandSql} IS NOT NULL`)
      return builder
    }
    default: {
      const exhaustive: never = expression
      return exhaustive
    }
  }
}

const appendUnary = (
  rule: Extract<Rule, { type: "unary" }>,
  builder: QueryBuilder,
  state: PlannerState,
): QueryBuilder => {
  if (!isPredicateExpression(rule.predicate)) {
    throw new Error(
      "postgres adapter does not support JavaScript unary predicates; use term.is(...) with SQL expression predicates",
    )
  }

  return appendPredicateExpression(rule.predicate, builder, state)
}

const appendStaticFilters = (
  builder: QueryBuilder,
  state: PlannerState,
  alias: string,
  filters?: ReadonlyArray<PostgresSourceFilter>,
): void => {
  filters?.forEach(filter => {
    builder.whereClauses.push(bindStaticFilterSql(state, filter, alias))
  })
}

const appendSourcePredicates = (
  builder: QueryBuilder,
  state: PlannerState,
  alias: string,
  predicates?: ReadonlyArray<PostgresSourcePredicate>,
  orderings?: ReadonlyArray<PostgresSourceOrdering>,
): void => {
  predicates?.forEach(predicate => {
    const columnSql = `${quoteIdentifier(alias)}.${quoteIdentifier(predicate.column)}`

    if (predicate.op === "in") {
      const param = nextParam(state, [...predicate.values])
      builder.whereClauses.push(`${columnSql} = ANY(${param})`)
      return
    }

    if (predicate.op === "eq") {
      const param = nextParam(state, predicate.value)
      builder.whereClauses.push(`${columnSql} IS NOT DISTINCT FROM ${param}`)
      return
    }

    const ordering = findOrderingForColumn(predicate.column, orderings)
    const leftExpression = ordering
      ? renderOrderedColumnSql(columnSql, ordering)
      : columnSql
    const operator =
      predicate.op === "gt"
        ? ">"
        : predicate.op === "ge"
          ? ">="
          : predicate.op === "lt"
            ? "<"
            : "<="
    const value = resolvePredicateValue(predicate, ordering)
    const param = nextParam(state, value)
    builder.whereClauses.push(`${leftExpression} ${operator} ${param}`)
  })
}

const collectRelationTermSources = (
  rule: Rule,
  term: symbol,
  state: PlannerState,
): Array<{ source: PostgresRelationSource; side: "left" | "right" }> => {
  const output: Array<{
    source: PostgresRelationSource
    side: "left" | "right"
  }> = []

  const visit = (node: Rule): void => {
    switch (node.type) {
      case "relation": {
        const source = state.relationMappings.get(node.relationId)
        if (!source) {
          throw new Error("postgres adapter is missing a relation mapping")
        }
        if (source.kind === "prepared") {
          return
        }

        if (node.left === term) {
          output.push({ source, side: "left" })
        }

        if (node.right === term) {
          output.push({ source, side: "right" })
        }

        return
      }
      case "and":
      case "or":
        node.children.forEach(visit)
        return
      case "not":
      case "select":
      case "distinct":
      case "memo":
      case "forall":
        visit(node.child)
        return
      case "ref": {
        const definition = state.definitions.get(node.name)
        if (!definition) {
          throw new Error(`unknown ref "${node.name}"`)
        }

        visit(definition)
        return
      }
      case "term":
      case "exists":
      case "unary":
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

  visit(rule)
  return output
}

const buildTermDomainQuery = (
  rule: Extract<Rule, { type: "forall" }>,
  state: PlannerState,
): string => {
  const explicitDomain = state.termDomains.get(rule.term)
  if (explicitDomain) {
    const alias = nextAlias(state, "dom")
    const builder = createBuilder()
    const valueSql = `${quoteIdentifier(alias)}.${quoteIdentifier(explicitDomain.valueColumn)}`
    builder.fromClauses.push(
      `FROM ${quoteQualifiedIdentifier(explicitDomain.table)} ${quoteIdentifier(alias)}`,
    )
    builder.whereClauses.push(`${valueSql} IS NOT NULL`)
    appendStaticFilters(builder, state, alias, explicitDomain.staticFilters)
    appendSourcePredicates(
      builder,
      state,
      alias,
      explicitDomain.predicates,
      explicitDomain.orderings,
    )
    const where =
      builder.whereClauses.length === 0
        ? ""
        : ` WHERE ${builder.whereClauses.join(" AND ")}`

    return `SELECT DISTINCT ${valueSql} AS candidate ${builder.fromClauses.join(" ")}${where}`
  }

  const derivedSources = collectRelationTermSources(
    rule.child,
    rule.term,
    state,
  )
  if (derivedSources.length === 0) {
    state.diagnostics.push({
      level: "warning",
      code: "forall-without-domain-source",
      message:
        "forall term has no explicit domain source and no relation-derived candidate source.",
      recommendation:
        "Provide a term domain mapping or anchor the quantified term through a relation so the postgres adapter can build a complete candidate set.",
    })
    return "SELECT NULL AS candidate WHERE FALSE"
  }

  state.diagnostics.push({
    level: "info",
    code: "forall-derived-domain",
    message: "forall candidate domain is being derived from relation sources.",
    recommendation:
      "If this quantified term has a broader semantic domain than the participating relations expose, configure an explicit term domain source.",
  })

  return derivedSources
    .map(entry => {
      const alias = nextAlias(state, "dom")
      const builder = createBuilder()
      const column =
        entry.side === "left"
          ? entry.source.leftColumn
          : entry.source.rightColumn
      const valueSql = `${quoteIdentifier(alias)}.${quoteIdentifier(column)}`
      builder.fromClauses.push(
        `FROM ${quoteQualifiedIdentifier(entry.source.table)} ${quoteIdentifier(alias)}`,
      )
      builder.whereClauses.push(`${valueSql} IS NOT NULL`)
      appendStaticFilters(builder, state, alias, entry.source.staticFilters)
      appendSourcePredicates(
        builder,
        state,
        alias,
        entry.source.predicates,
        entry.source.orderings,
      )
      const where =
        builder.whereClauses.length === 0
          ? ""
          : ` WHERE ${builder.whereClauses.join(" AND ")}`

      return `SELECT ${valueSql} AS candidate ${builder.fromClauses.join(" ")}${where}`
    })
    .join(" UNION ")
}

const compileExistsSql = (
  rule: Rule,
  state: PlannerState,
  inheritedColumns: ReadonlyMap<symbol, string>,
): string => {
  switch (rule.type) {
    case "or": {
      const branches = rule.children.map(child => {
        return compileExistsSql(child, state, inheritedColumns)
      })

      return branches.join(" UNION ALL ")
    }
    case "not": {
      return `SELECT 1 WHERE NOT EXISTS(${compileExistsSql(rule.child, state, inheritedColumns)})`
    }
    case "forall": {
      const boundValue = inheritedColumns.get(rule.term)
      if (boundValue) {
        return `SELECT 1 WHERE EXISTS(${compileExistsSql(rule.child, state, inheritedColumns)})`
      }

      const candidateSql = buildTermDomainQuery(rule, state)
      const candidateAlias = nextAlias(state, "forall")
      const childColumns = cloneColumns(inheritedColumns)
      childColumns.set(
        rule.term,
        `${quoteIdentifier(candidateAlias)}.candidate`,
      )

      return `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM (${candidateSql}) ${quoteIdentifier(candidateAlias)} WHERE NOT EXISTS(${compileExistsSql(rule.child, state, childColumns)}))`
    }
    case "exists": {
      const boundValue = inheritedColumns.get(rule.term)
      if (!boundValue) {
        throw new Error(
          "postgres adapter cannot compile exists(term) when the term is unbound",
        )
      }

      return compileTermExistenceSql(rule.term, boundValue, state)
    }
    case "memo":
      return compileExistsSql(rule.child, state, inheritedColumns)
    case "ref": {
      const definition = state.definitions.get(rule.name)
      if (!definition) {
        throw new Error(`unknown ref "${rule.name}"`)
      }

      return compileExistsSql(definition, state, inheritedColumns)
    }
    case "select":
      state.selectApplied += 1
      return compileExistsSql(rule.child, state, inheritedColumns)
    case "distinct":
      state.distinctApplied += 1
      return compileExistsSql(rule.child, state, inheritedColumns)
    case "given": {
      const contextColumns = cloneColumns(inheritedColumns)
      const contextSql = compileExistsSql(rule.context, state, contextColumns)
      const ruleSql = compileExistsSql(rule.rule, state, inheritedColumns)
      return `SELECT 1 WHERE EXISTS(${contextSql}) AND EXISTS(${ruleSql})`
    }
    case "term": {
      const builder = createBuilder()
      builder.columns = cloneColumns(inheritedColumns)
      appendTerm(rule, builder)
      return renderInnerSql(builder)
    }
    case "unary": {
      const builder = createBuilder()
      builder.columns = cloneColumns(inheritedColumns)
      appendUnary(rule, builder, state)
      return renderInnerSql(builder)
    }
    case "and":
    case "relation":
    case "exists":
    case "eq-value":
    case "eq-term":
    case "derives": {
      const builder = createBuilder()
      builder.columns = cloneColumns(inheritedColumns)
      appendConjunctiveRule(rule, builder, state)
      return renderInnerSql(builder)
    }
    default: {
      const exhaustive: never = rule
      return exhaustive
    }
  }
}

const appendConjunctiveRule = (
  rule: Rule,
  builder: QueryBuilder,
  state: PlannerState,
): QueryBuilder => {
  switch (rule.type) {
    case "and":
      return sortAndChildren(rule.children).reduce((current, child) => {
        return appendConjunctiveRule(child, current, state)
      }, builder)
    case "relation":
      return appendRelation(rule, builder, state)
    case "eq-value":
      return appendEqValue(rule, builder, state)
    case "eq-term":
      return appendEqTerm(rule, builder)
    case "memo":
      return appendConjunctiveRule(rule.child, builder, state)
    case "ref": {
      const definition = state.definitions.get(rule.name)
      if (!definition) {
        throw new Error(`unknown ref "${rule.name}"`)
      }

      return appendConjunctiveRule(definition, builder, state)
    }
    case "select":
      state.selectApplied += 1
      return appendConjunctiveRule(rule.child, builder, state)
    case "distinct":
      state.distinctApplied += 1
      return appendConjunctiveRule(rule.child, builder, state)
    case "derives":
      return appendEqTerm(
        { type: "eq-term", left: rule.entity, right: rule.from },
        builder,
      )
    case "given":
      builder.whereClauses.push(
        `EXISTS(${compileExistsSql(rule.context, state, builder.columns)})`,
      )
      return appendConjunctiveRule(rule.rule, builder, state)
    case "or":
    case "forall":
    case "exists":
      builder.whereClauses.push(
        `EXISTS(${compileExistsSql(rule, state, builder.columns)})`,
      )
      return builder
    case "not":
      builder.whereClauses.push(
        `NOT EXISTS(${compileExistsSql(rule.child, state, builder.columns)})`,
      )
      return builder
    case "term":
      return appendTerm(rule, builder)
    case "unary":
      return appendUnary(rule, builder, state)
    default: {
      const exhaustive: never = rule
      return exhaustive
    }
  }
}

const renderInnerSql = (builder: QueryBuilder): string => {
  const from = builder.fromClauses.join(" ")
  const where =
    builder.whereClauses.length === 0
      ? ""
      : ` WHERE ${builder.whereClauses.join(" AND ")}`

  if (from.length === 0) {
    return `SELECT 1${where}`
  }

  return `SELECT 1 ${from}${where}`
}

const relationMappingsById = (
  relationMappings: ReadonlyArray<PlannerRelationMapping>,
): Map<symbol, PlannerRelationSource> => {
  const output = new Map<symbol, PlannerRelationSource>()
  relationMappings.forEach(entry => {
    output.set(entry.relation.id, entry.source)
  })
  return output
}

const termDomainsById = (
  termDomains: ReadonlyArray<PostgresTermDomainSource<any>>,
): Map<symbol, PostgresTermDomainSource<any>> => {
  const output = new Map<symbol, PostgresTermDomainSource<any>>()
  termDomains.forEach(entry => {
    output.set(entry.term, entry)
  })
  return output
}

const termEncodingsById = (
  termEncodings: ReadonlyArray<PostgresTermEncoding<any>>,
): Map<symbol, PostgresTermEncoder<any>> => {
  const output = new Map<symbol, PostgresTermEncoder<any>>()
  termEncodings.forEach(entry => {
    output.set(entry.term, entry.encode)
  })
  return output
}

const createPlannerState = (
  rule: Rule,
  options: {
    relationMappings: ReadonlyArray<{
      relation: Relation<any, any>
      source: PlannerRelationSource
    }>
    termDomains?: ReadonlyArray<PostgresTermDomainSource<any>>
    termEncodings?: ReadonlyArray<PostgresTermEncoding<any>>
  },
): PlannerState => {
  return {
    relationMappings: relationMappingsById(options.relationMappings),
    termDomains: termDomainsById(options.termDomains ?? []),
    termAttributeAliases: new Map(),
    termEncodings: termEncodingsById(options.termEncodings ?? []),
    definitions: collectDefinitions(rule),
    termIds: new Map(),
    nextAlias: 0,
    params: [],
    diagnostics: [],
    sources: [],
    selectApplied: 0,
    distinctApplied: 0,
  }
}

const bindEnvironmentColumns = <Env extends Environment>(
  state: PlannerState,
  environment: Readonly<Env>,
): Map<symbol, string> => {
  const columns = new Map<symbol, string>()
  Object.getOwnPropertySymbols(environment).forEach(key => {
    columns.set(
      key,
      nextParam(state, encodeTermValue(state, key, environment[key])),
    )
    termKey(state, key)
  })
  return columns
}

const buildPlannedPredicate = (
  state: PlannerState,
  sql: string,
): PlannedPostgresPredicate => {
  return {
    sql,
    params: state.params,
    diagnostics: state.diagnostics,
    selectApplied: state.selectApplied,
    distinctApplied: state.distinctApplied,
    sources: state.sources,
  }
}

export const planPostgresPredicate = <Env extends Environment>(
  rule: Rule,
  options: {
    relationMappings: ReadonlyArray<PlannerRelationMapping>
    termDomains?: ReadonlyArray<PostgresTermDomainSource<any>>
    termEncodings?: ReadonlyArray<PostgresTermEncoding<any>>
    environment: Readonly<Env>
    bindings?: ReadonlyArray<PostgresTermSqlBinding<any>>
  },
): PlannedPostgresPredicate => {
  const state = createPlannerState(rule, options)
  const columns = bindEnvironmentColumns(state, options.environment)

  options.bindings?.forEach(binding => {
    columns.set(binding.term, binding.sql)
    termKey(state, binding.term)
  })

  const sql = `EXISTS(${compileExistsSql(rule, state, columns)})`
  return buildPlannedPredicate(state, sql)
}

export const planPostgresRule = <Env extends Environment>(
  rule: Rule,
  options: {
    relationMappings: ReadonlyArray<PlannerRelationMapping>
    termDomains?: ReadonlyArray<PostgresTermDomainSource<any>>
    termEncodings?: ReadonlyArray<PostgresTermEncoding<any>>
    environment: Readonly<Env>
  },
): PlannedPostgresRule => {
  const state = createPlannerState(rule, options)
  const columns = bindEnvironmentColumns(state, options.environment)
  const predicateSql = `EXISTS(${compileExistsSql(rule, state, columns)})`
  const predicate = buildPlannedPredicate(state, predicateSql)

  return {
    ...predicate,
    sql: `SELECT ${predicate.sql} AS ok`,
  }
}

type ExplainNode = {
  "Node Type"?: string
  "Relation Name"?: string
  "Index Name"?: string
  Plans?: ReadonlyArray<ExplainNode>
  [key: string]: unknown
}

const findSequentialScans = (
  node: ExplainNode,
  scans: Array<{ table: string; rows?: number }> = [],
): Array<{ table: string; rows?: number }> => {
  const nodeType = node["Node Type"]
  const relationName = node["Relation Name"]

  if (
    (nodeType === "Seq Scan" || nodeType === "Bitmap Heap Scan") &&
    relationName
  ) {
    scans.push({
      table: relationName,
      rows: node["Actual Rows"] as number | undefined,
    })
  }

  node["Plans"]?.forEach(child => {
    findSequentialScans(child, scans)
  })

  return scans
}

const analyzeExplainAndRecommend = (
  explainRows: ReadonlyArray<Record<string, unknown>>,
  plan: PlannedPostgresRule,
): Array<PostgresProofDiagnostic> => {
  const recommendations: Array<PostgresProofDiagnostic> = []

  if (!explainRows || explainRows.length === 0) {
    return recommendations
  }

  try {
    const topLevel = explainRows[0] as ExplainNode | undefined
    if (!topLevel) {
      return recommendations
    }

    const seqScans = findSequentialScans(topLevel)

    seqScans.forEach(scan => {
      const relatedSource = plan.sources.find(
        s => s.table === scan.table || s.table.includes(scan.table),
      )

      if (relatedSource && relatedSource.kind === "join-table") {
        recommendations.push({
          level: "warning",
          code: "sequential-scan-detected",
          message: `Sequential scan on ${quoteQualifiedIdentifier(scan.table)} (${scan.rows ?? 0} rows) observed in query plan.`,
          recommendation: `Consider creating a composite index on the join-table predicate columns to avoid sequential scans.`,
        })
      }
    })
  } catch {
    // Silently skip explain analysis on parse errors
  }

  return recommendations
}

const buildProofDetails = (
  plan: PlannedPostgresRule,
  ok: boolean,
  state: Pick<PlannerState, "selectApplied" | "distinctApplied">,
  explainRows?: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => {
  const allDiagnostics = [...plan.diagnostics]

  if (explainRows) {
    const explainRecommendations = analyzeExplainAndRecommend(explainRows, plan)
    allDiagnostics.push(...explainRecommendations)
  }

  return {
    ok,
    sql: plan.sql,
    paramCount: plan.params.length,
    diagnostics: allDiagnostics,
    relationSources: plan.sources,
    selectApplied: state.selectApplied,
    distinctApplied: state.distinctApplied,
    explain: explainRows,
  }
}

const failingKindForRule = (rule: Rule): EvaluationFailingNode["kind"] => {
  switch (rule.type) {
    case "relation":
    case "exists":
    case "eq-term":
    case "eq-value":
    case "derives":
    case "not":
    case "forall":
    case "or":
    case "term":
    case "unary":
      return rule.type
    case "given":
      return "given-context"
    case "ref":
      return "ref"
    default:
      return "unknown"
  }
}

const failingReasonForRule = (rule: Rule): string => {
  switch (rule.type) {
    case "relation":
      return "no matching rows"
    case "exists":
      return "bound term does not exist in the configured term domain"
    case "eq-term":
      return "term equality could not be satisfied"
    case "eq-value":
      return "term did not match expected value"
    case "derives":
      return "derived terms did not unify"
    case "not":
      return "negated child matched"
    case "or":
      return "no branch matched"
    case "forall":
      return "quantified candidate failed child rule"
    case "given":
      return "given context did not match"
    case "ref":
      return "referenced rule did not match"
    case "term":
      return "term has no candidate bindings"
    case "unary":
      return "unary predicate is unsupported in postgres adapter"
    default:
      return "rule did not match"
  }
}

const buildFailingNode = (
  rule: Rule,
  path: string,
  options: { includeSql: boolean; plan?: PlannedPostgresRule },
): EvaluationFailingNode => {
  return {
    kind: failingKindForRule(rule),
    path,
    reason: failingReasonForRule(rule),
    relationId: rule.type === "relation" ? rule.relationId : undefined,
    sql: options.includeSql ? options.plan?.sql : undefined,
    paramCount: options.includeSql ? options.plan?.params.length : undefined,
  }
}

export const createPostgresAdapter = <
  Env extends Environment = Environment,
  EvaluatorContext = unknown,
>(
  options: PostgresAdapterOptions<Env, EvaluatorContext>,
): EvaluatorAdapter<Env, EvaluatorContext> => {
  const probeRule = async (
    rule: Rule,
    environment: Readonly<Env>,
    relationMappings: ReadonlyArray<PlannerRelationMapping>,
  ): Promise<{ ok: boolean; plan: PlannedPostgresRule }> => {
    const plan = planPostgresRule(rule, {
      relationMappings,
      termDomains: options.termDomains,
      termEncodings: options.termEncodings,
      environment,
    })
    const result = await options.queryExecutor.query<{ ok: boolean }>(
      plan.sql,
      plan.params,
    )
    return {
      ok: result.rows[0]?.ok === true,
      plan,
    }
  }

  const evaluateWithMappings = async (
    rule: Rule,
    environment: Readonly<Env>,
    relationMappings: ReadonlyArray<PlannerRelationMapping>,
  ): Promise<boolean> => {
    const result = await probeRule(rule, environment, relationMappings)
    return result.ok
  }

  const findFirstFailingNode = async (
    rule: Rule,
    environment: Readonly<Env>,
    path: string,
    definitions: ReadonlyMap<string, Rule>,
    relationMappings: ReadonlyArray<PlannerRelationMapping>,
  ): Promise<EvaluationFailingNode | undefined> => {
    switch (rule.type) {
      case "ref": {
        const definition = definitions.get(rule.name)
        if (!definition) {
          throw new Error(`unknown ref "${rule.name}"`)
        }
        return findFirstFailingNode(
          definition,
          environment,
          `${path}.ref(${rule.name})`,
          definitions,
          relationMappings,
        )
      }
      case "memo":
        return findFirstFailingNode(
          rule.child,
          environment,
          `${path}.memo`,
          definitions,
          relationMappings,
        )
      case "select":
        return findFirstFailingNode(
          rule.child,
          environment,
          `${path}.select`,
          definitions,
          relationMappings,
        )
      case "distinct":
        return findFirstFailingNode(
          rule.child,
          environment,
          `${path}.distinct`,
          definitions,
          relationMappings,
        )
      default:
        break
    }

    const current = await probeRule(rule, environment, relationMappings)
    if (current.ok) {
      return undefined
    }

    switch (rule.type) {
      case "and": {
        const prefix: Array<Rule> = []
        for (let index = 0; index < rule.children.length; index += 1) {
          const child = rule.children[index]!
          const childPath = `${path}.and[${index}]`
          prefix.push(child)
          const prefixRule: Rule =
            prefix.length === 1
              ? prefix[0]!
              : {
                  type: "and",
                  children: [...prefix],
                }
          const prefixResult = await probeRule(
            prefixRule,
            environment,
            relationMappings,
          )
          if (!prefixResult.ok) {
            return (
              (await findFirstFailingNode(
                child,
                environment,
                childPath,
                definitions,
                relationMappings,
              )) ??
              buildFailingNode(child, childPath, {
                includeSql: options.includeFailingNodeSql === true,
                plan: prefixResult.plan,
              })
            )
          }
        }
        return buildFailingNode(rule, path, {
          includeSql: options.includeFailingNodeSql === true,
          plan: current.plan,
        })
      }
      case "or": {
        for (let index = 0; index < rule.children.length; index += 1) {
          const child = rule.children[index]!
          const childPath = `${path}.or[${index}]`
          const nested = await findFirstFailingNode(
            child,
            environment,
            childPath,
            definitions,
            relationMappings,
          )
          if (nested) {
            return nested
          }
        }
        return buildFailingNode(rule, path, {
          includeSql: options.includeFailingNodeSql === true,
          plan: current.plan,
        })
      }
      case "given": {
        const contextResult = await probeRule(
          rule.context,
          environment,
          relationMappings,
        )
        if (!contextResult.ok) {
          return (
            (await findFirstFailingNode(
              rule.context,
              environment,
              `${path}.context`,
              definitions,
              relationMappings,
            )) ??
            buildFailingNode(rule, path, {
              includeSql: options.includeFailingNodeSql === true,
              plan: contextResult.plan,
            })
          )
        }
        return findFirstFailingNode(
          rule.rule,
          environment,
          `${path}.rule`,
          definitions,
          relationMappings,
        )
      }
      case "relation":
      case "exists":
      case "eq-term":
      case "eq-value":
      case "not":
      case "forall":
      case "term":
      case "unary":
      case "derives":
        return buildFailingNode(rule, path, {
          includeSql: options.includeFailingNodeSql === true,
          plan: current.plan,
        })
      default: {
        const exhaustive: never = rule
        return exhaustive
      }
    }
  }

  const evaluateWithProofAndMappings = async (
    rule: Rule,
    environment: Readonly<Env>,
    relationMappings: ReadonlyArray<PlannerRelationMapping>,
  ): Promise<EvaluationProof> => {
    const plan = planPostgresRule(rule, {
      relationMappings,
      termDomains: options.termDomains,
      termEncodings: options.termEncodings,
      environment,
    })
    const result = await options.queryExecutor.query<{ ok: boolean }>(
      plan.sql,
      plan.params,
    )
    const ok = result.rows[0]?.ok === true
    const definitions = collectDefinitions(rule)
    const failing = ok
      ? undefined
      : await findFirstFailingNode(
          rule,
          environment,
          "root",
          definitions,
          relationMappings,
        )

    let explainRows: ReadonlyArray<Record<string, unknown>> | undefined
    if (options.explainQuery) {
      const explainResult = await options.queryExecutor.query(
        `EXPLAIN (FORMAT JSON) ${plan.sql}`,
        plan.params,
      )
      explainRows = explainResult.rows
    }

    const proof: EvaluationProof = {
      ok,
      rule,
      failing,
      details: buildProofDetails(
        plan,
        ok,
        {
          selectApplied: plan.selectApplied,
          distinctApplied: plan.distinctApplied,
        },
        explainRows,
      ),
    }

    return proof
  }

  const createPreparedAdapter = async (
    prepareOptions: EvaluatorPrepareOptions<Env>,
  ): Promise<PreparedEvaluatorAdapter<Env>> => {
    const preloadRelations = prepareOptions.preload ?? []
    if (preloadRelations.length === 0) {
      return {
        evaluate(rule, environment) {
          return evaluateWithMappings(
            rule,
            environment,
            options.relationMappings,
          )
        },
        evaluateWithProof(rule, environment) {
          return evaluateWithProofAndMappings(
            rule,
            environment,
            options.relationMappings,
          )
        },
      }
    }

    const preparedSources = new Map<symbol, PreparedPostgresRelationSource>()
    for (const relationToPreload of preloadRelations) {
      if (preparedSources.has(relationToPreload.id)) {
        continue
      }

      const mapping = options.relationMappings.find(
        entry => entry.relation.id === relationToPreload.id,
      )
      if (!mapping) {
        throw new Error(
          "postgres adapter cannot preload a relation that has no mapping",
        )
      }

      const pairs = await runPreparedHydration(
        mapping.source,
        options.queryExecutor,
      )
      preparedSources.set(relationToPreload.id, {
        kind: "prepared",
        pairs,
      })
    }

    const preparedMappings = options.relationMappings.map(entry => {
      const preparedSource = preparedSources.get(entry.relation.id)
      if (!preparedSource) {
        return entry
      }

      return {
        relation: entry.relation,
        source: preparedSource,
      }
    })

    return {
      evaluate(rule, environment) {
        return evaluateWithMappings(rule, environment, preparedMappings)
      },
      evaluateWithProof(rule, environment) {
        return evaluateWithProofAndMappings(rule, environment, preparedMappings)
      },
    }
  }

  return {
    async evaluate(rule, environment) {
      return evaluateWithMappings(rule, environment, options.relationMappings)
    },
    async evaluateWithProof(rule, environment) {
      return evaluateWithProofAndMappings(
        rule,
        environment,
        options.relationMappings,
      )
    },
    async prepare(prepareOptions) {
      return createPreparedAdapter(prepareOptions)
    },
    async filter(rule, filterOptions) {
      const state = createPlannerState(rule, options)
      const candidateAlias = nextAlias(state, "cand")
      const columns = bindEnvironmentColumns(state, filterOptions.environment)
      columns.set(
        filterOptions.term,
        `${quoteIdentifier(candidateAlias)}.candidate`,
      )

      const candidateSql =
        filterOptions.candidates && filterOptions.candidates.length > 0
          ? (() => {
              const valuesSql = filterOptions.candidates
                .map(candidate => {
                  return `(${nextParam(
                    state,
                    encodeTermValue(state, filterOptions.term, candidate),
                  )})`
                })
                .join(", ")
              return `SELECT DISTINCT ${quoteIdentifier("input")}.candidate AS candidate FROM (VALUES ${valuesSql}) ${quoteIdentifier("input")}(candidate)`
            })()
          : (() => {
              const explicitDomain = state.termDomains.get(filterOptions.term)
              if (explicitDomain) {
                const alias = nextAlias(state, "dom")
                const builder = createBuilder()
                const valueSql = `${quoteIdentifier(alias)}.${quoteIdentifier(explicitDomain.valueColumn)}`
                builder.fromClauses.push(
                  `FROM ${quoteQualifiedIdentifier(explicitDomain.table)} ${quoteIdentifier(alias)}`,
                )
                builder.whereClauses.push(`${valueSql} IS NOT NULL`)
                appendStaticFilters(
                  builder,
                  state,
                  alias,
                  explicitDomain.staticFilters,
                )
                const where =
                  builder.whereClauses.length === 0
                    ? ""
                    : ` WHERE ${builder.whereClauses.join(" AND ")}`

                return `SELECT DISTINCT ${valueSql} AS candidate ${builder.fromClauses.join(" ")}${where}`
              }

              const derivedSources = collectRelationTermSources(
                rule,
                filterOptions.term,
                state,
              )
              if (derivedSources.length === 0) {
                state.diagnostics.push({
                  level: "warning",
                  code: "filter-without-domain-source",
                  message:
                    "filter target term has no explicit domain source and no relation-derived candidate source.",
                  recommendation:
                    "Provide candidates or configure a term domain mapping so the postgres adapter can construct the filter candidate set.",
                })
                return "SELECT NULL AS candidate WHERE FALSE"
              }

              state.diagnostics.push({
                level: "info",
                code: "filter-derived-domain",
                message:
                  "filter candidate domain is being derived from relation sources.",
                recommendation:
                  "If this term has a broader semantic domain than participating relations expose, pass explicit candidates or configure a term domain source.",
              })

              return derivedSources
                .map(entry => {
                  const alias = nextAlias(state, "dom")
                  const builder = createBuilder()
                  const column =
                    entry.side === "left"
                      ? entry.source.leftColumn
                      : entry.source.rightColumn
                  const valueSql = `${quoteIdentifier(alias)}.${quoteIdentifier(column)}`
                  builder.fromClauses.push(
                    `FROM ${quoteQualifiedIdentifier(entry.source.table)} ${quoteIdentifier(alias)}`,
                  )
                  builder.whereClauses.push(`${valueSql} IS NOT NULL`)
                  appendStaticFilters(
                    builder,
                    state,
                    alias,
                    entry.source.staticFilters,
                  )
                  const where =
                    builder.whereClauses.length === 0
                      ? ""
                      : ` WHERE ${builder.whereClauses.join(" AND ")}`

                  return `SELECT ${valueSql} AS candidate ${builder.fromClauses.join(" ")}${where}`
                })
                .join(" UNION ")
            })()

      const querySql = `SELECT ${quoteIdentifier(candidateAlias)}.candidate AS candidate FROM (${candidateSql}) ${quoteIdentifier(candidateAlias)} WHERE EXISTS(${compileExistsSql(rule, state, columns)})`
      const result = await options.queryExecutor.query<{ candidate: unknown }>(
        querySql,
        state.params,
      )

      return result.rows.map(row => row.candidate as any)
    },
  }
}

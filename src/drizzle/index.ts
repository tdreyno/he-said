import {
  getTableConfig,
  type AnyPgColumn,
  type AnyPgTable,
} from "drizzle-orm/pg-core"
import type {
  PostgresJoinTableRelationSource,
  PostgresQueryExecutor,
  PostgresTermDomainSource,
  PostgresTermEncoding,
} from "../core/algebra-postgres"
import {
  attr,
  getTermInfo,
  term,
  type AttributeAccessor,
  type Environment,
  type Relation,
  type SourcePredicate,
  type Term,
} from "../core/algebra"
import { associates, belongsTo } from "../core/algebra-postgres-helpers"
import type { ScopePath } from "../rebac/rebac-builder"
import { resourceType, type ResourceType } from "../rebac/resource-type"

type TableName = {
  name: string
  schema?: string
}

const qualifyTable = ({ name, schema }: TableName): string => {
  return schema ? `${schema}.${name}` : name
}

const primaryKeyColumns = (table: AnyPgTable): ReadonlyArray<AnyPgColumn> => {
  const config = getTableConfig(table)
  const explicitPrimaryKeys = config.primaryKeys.flatMap(entry => entry.columns)
  if (explicitPrimaryKeys.length > 0) {
    return explicitPrimaryKeys
  }
  return config.columns.filter(column => column.primary)
}

const requireSingleColumn = (
  columns: ReadonlyArray<AnyPgColumn>,
  context: string,
): AnyPgColumn => {
  if (columns.length !== 1) {
    throw new Error(`${context} requires a single-column mapping`)
  }
  return columns[0]!
}

export const fromFk = (column: AnyPgColumn) => {
  const table = column.table as AnyPgTable
  const tableConfig = getTableConfig(table)
  const matchingFks = tableConfig.foreignKeys.filter(fk => {
    const reference = fk.reference()
    return reference.columns.some(entry => entry.name === column.name)
  })
  if (matchingFks.length === 0) {
    throw new Error(
      `fromFk could not find an FK mapping for column "${column.name}"`,
    )
  }
  if (matchingFks.length > 1) {
    throw new Error(
      `fromFk found multiple FK mappings for column "${column.name}"`,
    )
  }

  const fk = matchingFks[0]!
  const reference = fk.reference()
  const foreignColumn = requireSingleColumn(
    reference.columns,
    `fromFk(${column.name})`,
  )
  const leftPrimaryKey = requireSingleColumn(
    primaryKeyColumns(table),
    `fromFk(${column.name})`,
  )

  return belongsTo({
    table: qualifyTable({ name: tableConfig.name, schema: tableConfig.schema }),
    fk: foreignColumn.name,
    pk: leftPrimaryKey.name,
  })
}

export const inColumn = <T>(
  column: AnyPgColumn,
  values: ReadonlyArray<T>,
): SourcePredicate => {
  return {
    column: column.name,
    op: "in",
    values,
  }
}

export const associatesTable = (
  table: AnyPgTable,
  options: {
    left: AnyPgColumn
    right: AnyPgColumn
    predicates?: ReadonlyArray<SourcePredicate>
  },
): PostgresJoinTableRelationSource => {
  const tableConfig = getTableConfig(table)
  return associates({
    table: qualifyTable({ name: tableConfig.name, schema: tableConfig.schema }),
    left: options.left.name,
    right: options.right.name,
    predicates: options.predicates,
  })
}

type ContextTerms = Record<string, Term<any>>

type AccessorMap<Row extends Record<string, unknown>> = {
  readonly [K in keyof Row & string]: AttributeAccessor<Row, Row[K]>
}

export type DrizzleRowVar<TTable extends AnyPgTable> = Term<
  TTable["$inferSelect"]
> & {
  readonly $: AccessorMap<TTable["$inferSelect"]>
}

type RowVarMetadata<Row extends Record<string, unknown>> = {
  accessors: AccessorMap<Row>
  domain: PostgresTermDomainSource<Row>
  keyProperty: string
  primaryKeyProperties: ReadonlyArray<string>
}

const rowVarMetadata = new Map<symbol, RowVarMetadata<any>>()

const toKnownRootTerm = (value: symbol): symbol => {
  return getTermInfo(value as Term<unknown>).root as symbol
}

const rowVarFor = (value: symbol): RowVarMetadata<any> => {
  const metadata = rowVarMetadata.get(toKnownRootTerm(value))
  if (!metadata) {
    throw new Error("rowVar metadata is not available for this term")
  }
  return metadata
}

const rowAccessorsFor = (value: symbol): AccessorMap<any> => {
  return rowVarFor(value).accessors
}

const rowAccessorGetter = function (this: symbol): AccessorMap<any> {
  return rowAccessorsFor(this)
}

const installRowVarAccessors = (): void => {
  const symbolPrototype = Symbol.prototype as symbol & {
    $?: unknown
  }
  const descriptor = Object.getOwnPropertyDescriptor(symbolPrototype, "$")

  if (!descriptor) {
    Object.defineProperty(symbolPrototype, "$", {
      get: rowAccessorGetter,
      enumerable: false,
      configurable: true,
    })
    return
  }

  if (descriptor.get !== rowAccessorGetter) {
    throw new Error("Symbol.prototype.$ is already defined")
  }
}

installRowVarAccessors()

const selectResourceKey = (
  columns: ReadonlyArray<AnyPgColumn>,
): AnyPgColumn => {
  const idColumn = columns.find(column => column.name === "id")
  return idColumn ?? columns[0]!
}

const tablePropertyColumns = (
  table: AnyPgTable,
): ReadonlyArray<{ property: string; column: AnyPgColumn }> => {
  return Object.entries(table)
    .filter(
      (entry): entry is [string, AnyPgColumn] =>
        typeof entry[0] === "string" &&
        !!entry[1] &&
        typeof entry[1] === "object" &&
        "name" in entry[1] &&
        (entry[1] as AnyPgColumn).table === table,
    )
    .map(([property, column]) => ({ property, column }))
}

const keyPropertiesForTable = (
  table: AnyPgTable,
): ReadonlyArray<{ property: string; column: AnyPgColumn }> => {
  const pkColumns = primaryKeyColumns(table)
  if (pkColumns.length === 0) {
    return []
  }
  const byColumn = new Map(pkColumns.map(column => [column.name, column]))
  return tablePropertyColumns(table).filter(entry =>
    byColumn.has(entry.column.name),
  )
}

const requireRowVarMetadata = <TTable extends AnyPgTable>(
  row: DrizzleRowVar<TTable>,
): RowVarMetadata<TTable["$inferSelect"]> => {
  return rowVarFor(row as unknown as symbol) as RowVarMetadata<
    TTable["$inferSelect"]
  >
}

export const rowVarDomain = <TTable extends AnyPgTable>(
  row: DrizzleRowVar<TTable>,
): PostgresTermDomainSource<TTable["$inferSelect"]> => {
  return requireRowVarMetadata(row).domain
}

export const rowVarEncoding = <TTable extends AnyPgTable>(
  row: DrizzleRowVar<TTable>,
): PostgresTermEncoding<TTable["$inferSelect"]> => {
  const metadata = requireRowVarMetadata(row)
  const root = toKnownRootTerm(row as unknown as symbol) as Term<
    TTable["$inferSelect"]
  >
  return {
    term: root,
    encode(value) {
      if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>
        if (metadata.keyProperty in record) {
          return record[metadata.keyProperty]
        }
      }
      if (metadata.primaryKeyProperties.length === 1) {
        return value
      }
      throw new Error(
        "rowVar encoding for composite primary keys requires an object containing the selected key property",
      )
    },
  }
}

export const bindRowVar = <TTable extends AnyPgTable>(
  row: DrizzleRowVar<TTable>,
  value: TTable["$inferSelect"] | unknown,
): Environment => {
  const metadata = requireRowVarMetadata(row)
  const root = toKnownRootTerm(row as unknown as symbol)
  const ref =
    value !== null &&
    typeof value === "object" &&
    metadata.keyProperty in (value as Record<string, unknown>)
      ? (value as Record<string, unknown>)[metadata.keyProperty]
      : value
  return {
    [root]: ref,
  }
}

const toCamelCase = (value: string): string => {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

export const drizzleResourceType = <
  TTable extends AnyPgTable,
  Scope,
  Context extends ContextTerms = Record<never, never>,
>(
  table: TTable,
  options: {
    owner: ScopePath<TTable["$inferSelect"], Scope>
    contextTerms?: Context
    fixed?: Readonly<Record<string, unknown>>
  },
): ResourceType<TTable["$inferSelect"], Scope, Context> => {
  const tableConfig = getTableConfig(table)
  const pkColumns = primaryKeyColumns(table)
  if (pkColumns.length === 0) {
    throw new Error(
      `drizzleResourceType(${tableConfig.name}) requires a primary key on the table`,
    )
  }

  const keyColumn = selectResourceKey(pkColumns)
  const context = (options.contextTerms ?? {}) as Context
  const fixed = options.fixed ?? {}
  if (pkColumns.length > 1) {
    const uncoveredColumns = pkColumns
      .map(column => column.name)
      .filter(name => name !== keyColumn.name)
      .filter(name => {
        const camel = toCamelCase(name)
        return (
          !(name in context) &&
          !(camel in context) &&
          !(name in fixed) &&
          !(camel in fixed)
        )
      })
    if (uncoveredColumns.length > 0) {
      throw new Error(
        `drizzleResourceType(${tableConfig.name}) requires contextTerms/fixed for composite PK columns: ${uncoveredColumns.join(", ")}`,
      )
    }
  }

  return resourceType<TTable["$inferSelect"], Scope, Context>({
    table: qualifyTable({ name: tableConfig.name, schema: tableConfig.schema }),
    key: keyColumn.name,
    context,
    owner: options.owner,
  })
}

export const rowVar = <TTable extends AnyPgTable>(
  table: TTable,
): DrizzleRowVar<TTable> => {
  const row = term<TTable["$inferSelect"]>() as DrizzleRowVar<TTable>
  const tableConfig = getTableConfig(table)
  const pkColumns = primaryKeyColumns(table)
  if (pkColumns.length === 0) {
    throw new Error(`rowVar(${tableConfig.name}) requires a primary key`)
  }

  const keyColumn = selectResourceKey(pkColumns)
  const keyProperties = keyPropertiesForTable(table)
  const keyPropertyEntry =
    keyProperties.find(entry => entry.column.name === keyColumn.name) ??
    tablePropertyColumns(table).find(
      entry => entry.column.name === keyColumn.name,
    )
  if (!keyPropertyEntry) {
    throw new Error(
      `rowVar(${tableConfig.name}) could not map key column "${keyColumn.name}" to a table property`,
    )
  }

  const propertyColumns = tablePropertyColumns(table)
  const accessors = propertyColumns.reduce(
    (output, entry) => {
      output[entry.property] = attr(
        row as Term<TTable["$inferSelect"]>,
        entry.property as keyof TTable["$inferSelect"] & string,
      ) as AttributeAccessor<TTable["$inferSelect"], unknown>
      return output
    },
    {} as Record<string, AttributeAccessor<TTable["$inferSelect"], unknown>>,
  ) as AccessorMap<TTable["$inferSelect"]>

  const columns = propertyColumns.reduce(
    (output, entry) => {
      output[entry.property] = entry.column.name
      return output
    },
    {} as Record<string, string>,
  )

  rowVarMetadata.set(row as unknown as symbol, {
    accessors,
    keyProperty: keyPropertyEntry.property,
    primaryKeyProperties: keyProperties.map(entry => entry.property),
    domain: {
      term: row as Term<TTable["$inferSelect"]>,
      table: qualifyTable({
        name: tableConfig.name,
        schema: tableConfig.schema,
      }),
      valueColumn: keyColumn.name,
      columns,
    },
  })

  return row
}

export const via = <Left, Right>(
  navigation: Relation<Left, Right>,
): Relation<Left, Right> => {
  return navigation
}

export const drizzleExecutor = (db: {
  $client?: {
    query: <Row extends Record<string, unknown>>(
      sql: string,
      params: ReadonlyArray<unknown>,
    ) => Promise<{ rows: ReadonlyArray<Row> }>
  }
  execute?: (query: unknown) => Promise<unknown>
}): PostgresQueryExecutor => {
  if (db.$client?.query) {
    return {
      async query<Row extends Record<string, unknown>>(
        sql: string,
        params: ReadonlyArray<unknown>,
      ) {
        return db.$client!.query<Row>(sql, params)
      },
    }
  }

  if (db.execute) {
    return {
      async query<Row extends Record<string, unknown>>(
        sql: string,
        params: ReadonlyArray<unknown>,
      ) {
        const result = await db.execute!({ sql, params })
        const rows = (result as { rows?: ReadonlyArray<Row> }).rows
        if (!rows) {
          throw new Error(
            "drizzleExecutor(db.execute) expected a result with rows",
          )
        }
        return { rows }
      },
    }
  }

  throw new Error(
    "drizzleExecutor requires db.$client.query(sql, params) or db.execute(...)",
  )
}

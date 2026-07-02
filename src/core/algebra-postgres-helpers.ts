import type {
  PostgresEdgeRelationSource,
  PostgresJoinTableRelationSource,
} from "./algebra-postgres"

export type BelongsToOptions = Omit<
  PostgresEdgeRelationSource,
  "kind" | "leftColumn" | "rightColumn"
> & {
  fk: string
  pk?: string
}

export type AssociatesOptions = Omit<
  PostgresJoinTableRelationSource,
  "kind" | "leftColumn" | "rightColumn"
> & {
  left: string
  right: string
}

export const belongsTo = (
  options: BelongsToOptions,
): PostgresEdgeRelationSource => {
  const { fk, pk = "id", ...source } = options
  return {
    ...source,
    kind: "edge",
    leftColumn: pk,
    rightColumn: fk,
  }
}

export const associates = (
  options: AssociatesOptions,
): PostgresJoinTableRelationSource => {
  const { left, right, ...source } = options
  return {
    ...source,
    kind: "join-table",
    leftColumn: left,
    rightColumn: right,
  }
}

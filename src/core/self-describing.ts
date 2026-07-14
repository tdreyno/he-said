import { getTermInfo, relation, type Relation, type Term } from "./algebra"
import type {
  PostgresRelationSource,
  PostgresTermDomainSource,
} from "./algebra-postgres"

/**
 * Self-describing algebra objects: relations and terms that carry their own
 * Postgres source / term-domain metadata, discovered by the planner whenever
 * no explicit mapping is configured for them. Metadata lives in module-level
 * side tables keyed by the relation/term symbol — the same pattern the core
 * algebra uses for term metadata — so the algebra objects themselves stay
 * plain symbols/functions.
 *
 * Explicit adapter configuration always wins: discovery only fills gaps.
 */

const relationSources = new Map<symbol, PostgresRelationSource>()

const termDomains = new Map<symbol, PostgresTermDomainSource<unknown>>()

/** Attach a Postgres source to an existing relation. Returns the relation. */
export const attachRelationSource = <Left, Right>(
  rel: Relation<Left, Right>,
  source: PostgresRelationSource,
): Relation<Left, Right> => {
  relationSources.set(rel.id, source)
  return rel
}

/** The source attached to a relation, if any. */
export const attachedRelationSource = (
  relationId: symbol,
): PostgresRelationSource | undefined => {
  return relationSources.get(relationId)
}

/**
 * Attach a term-domain source (backing table + value column) to a term, so
 * `exists(term)` and candidate filtering can compile without an explicit
 * termDomains entry. Returns the term.
 */
export const attachTermDomain = <T>(
  t: Term<T>,
  domain: Omit<PostgresTermDomainSource<T>, "term">,
): Term<T> => {
  const root = getTermInfo(t).root as symbol
  termDomains.set(root, {
    ...domain,
    term: root as unknown as Term<unknown>,
  })
  return t
}

/** The term-domain source attached to a term root, if any. */
export const attachedTermDomain = (
  root: symbol,
): PostgresTermDomainSource<unknown> | undefined => {
  return termDomains.get(root)
}

/** @internal Iterate attached relation sources (planner discovery). */
export const attachedRelationSourceEntries = (): IterableIterator<
  [symbol, PostgresRelationSource]
> => {
  return relationSources.entries()
}

/** @internal Iterate attached term domains (planner discovery). */
export const attachedTermDomainEntries = (): IterableIterator<
  [symbol, PostgresTermDomainSource<unknown>]
> => {
  return termDomains.entries()
}

/**
 * Declare a relation AND its Postgres source in one step. The source rides
 * with the relation, so adapters need no `relationMappings` entry for it.
 * Unless overridden, the relation is labeled from its source
 * (`table.rightColumn`) so errors, proofs, and diagrams can name it.
 */
export const relationWithSource = <Left = unknown, Right = unknown>(
  source: PostgresRelationSource,
  label?: string,
): Relation<Left, Right> => {
  return attachRelationSource(
    relation<Left, Right>(
      undefined,
      label ?? `${source.table}.${source.rightColumn}`,
    ),
    source,
  )
}

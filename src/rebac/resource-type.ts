import {
  exists as coreExists,
  term,
  type Environment,
  type Rule,
  type Term,
} from "../core/algebra"
import type { ScopePath } from "./rebac-builder"

// Extract the value type from a Term<V>
type TermValue<T extends Term<any>> = T extends Term<infer V> ? V : never

// Maps each context key to the value type of its term
type ContextValues<Context extends Record<string, Term<any>>> = {
  [K in keyof Context]: TermValue<Context[K]>
}

export interface ResourceTypeOptions<
  T,
  Scope,
  Context extends Record<string, Term<any>> = Record<never, never>,
> {
  /** Backing table name — stored for caller use (e.g. PostgresTermDomainSource). */
  table?: string
  /** Primary-key column name. Defaults to "id". */
  key?: string
  /** Extra context terms for composite-key resources, e.g. { branchId: branchTerm }. */
  context?: Context
  /** Path from this resource to the owning scope. */
  owner: ScopePath<T, Scope>
}

export interface ResourceType<
  T,
  Scope,
  Context extends Record<string, Term<any>> = Record<never, never>,
> {
  readonly _kind: "resource-type"
  /** The algebra term representing this resource — use as an environment key. */
  readonly term: Term<T>
  /** Backing table name (if provided). */
  readonly table: string | undefined
  /** Primary-key column. */
  readonly key: string
  /** @internal Ownership ScopePath, consumed by scopedPolicy. */
  readonly _owner: ScopePath<T, Scope>
  /** @internal Context terms map, consumed by bind(). */
  readonly _context: Context

  /** Returns a Rule that requires this resource to exist in its domain. */
  exists(): Rule
  /** Returns a Rule asserting this resource is owned by the given scope. */
  ownedBy(scope: Term<Scope>): Rule
  /**
   * Returns an Environment fragment that binds this resource's term (and any
   * context terms) to the values in `ref`. Pass this to `evaluator.evaluate()`
   * or spread it into an existing environment.
   */
  bind(ref: T & ContextValues<Context>): Environment
}

export const resourceType = <
  T,
  Scope = unknown,
  Context extends Record<string, Term<any>> = Record<never, never>,
>(
  options: ResourceTypeOptions<T, Scope, Context>,
): ResourceType<T, Scope, Context> => {
  const resourceTerm = term<T>()
  const { table, key = "id", context = {} as Context, owner } = options

  return {
    _kind: "resource-type",
    term: resourceTerm,
    table,
    key,
    _owner: owner,
    _context: context,

    exists() {
      return coreExists(resourceTerm)
    },

    ownedBy(scope: Term<Scope>): Rule {
      return owner(resourceTerm, scope)
    },

    bind(ref: T & ContextValues<Context>): Environment {
      const env: Environment = { [resourceTerm]: ref }
      for (const [ctxKey, ctxTerm] of Object.entries(context)) {
        env[ctxTerm as unknown as symbol] = (ref as Record<string, unknown>)[
          ctxKey
        ]
      }
      return env
    },
  }
}

export const isResourceType = (
  value: unknown,
): value is ResourceType<any, any, any> =>
  typeof value === "object" &&
  value !== null &&
  (value as { _kind?: unknown })._kind === "resource-type"

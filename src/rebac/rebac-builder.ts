import {
  and,
  or,
  term,
  type Environment,
  type EvaluationInput,
  type EvaluatorInstance,
  type Relation,
  type Rule,
  type SourceOrdering,
  type SourcePredicate,
  type Term,
} from "../core/algebra"
import { isResourceType, type ResourceType } from "./resource-type"

type AnyScopePath = ScopePath<any, any>

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isRule = (value: unknown): value is Rule => {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwn(value as object, "type") &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

const isAtLeastGrant = <Tier extends string>(
  value: unknown,
): value is AtLeastGrant<Tier> => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "at-least"
  )
}

const isReadScopeGrant = (value: unknown): value is ReadScopeGrant => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "read-scope"
  )
}

const isDenyGrant = (value: unknown): value is DenyGrant => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "deny"
  )
}

const normalizeLevel = (value: string): string => {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error("role tier names must be non-empty")
  }
  return normalized
}

const requirePath = (
  paths: ReadonlyArray<AnyScopePath>,
  methodName: string,
) => {
  if (paths.length === 0) {
    throw new Error(`${methodName} requires at least one path`)
  }
}

export type RoleTierRequirement<Tier extends string> = {
  minimum: Tier
  predicate: SourcePredicate
  ordering: SourceOrdering
}

export interface RoleTiers<Tier extends string> {
  readonly levels: ReadonlyArray<Tier>
  readonly ordering: Readonly<Record<Tier, number>>
  atLeast(tier: Tier): ReadonlyArray<Tier>
  source(column: string, minimum: Tier): RoleTierRequirement<Tier>
}

export const roleTiers = <const Levels extends readonly [string, ...string[]]>(
  ...levels: Levels
): RoleTiers<Levels[number]> => {
  const normalized = levels.map(normalizeLevel)
  const deduped = new Set(normalized)
  if (deduped.size !== normalized.length) {
    throw new Error("role tiers must be unique")
  }

  const ordering = normalized.reduce(
    (accumulator, level, index) => {
      accumulator[level as Levels[number]] = index + 1
      return accumulator
    },
    {} as Record<Levels[number], number>,
  )

  const findIndex = (tier: Levels[number]): number => {
    const index = normalized.indexOf(tier)
    if (index === -1) {
      throw new Error(`unknown role tier "${tier}"`)
    }
    return index
  }

  const source = (
    column: string,
    minimum: Levels[number],
  ): RoleTierRequirement<Levels[number]> => {
    const normalizedColumn = column.trim()
    if (normalizedColumn.length === 0) {
      throw new Error("role column is required")
    }
    findIndex(minimum)
    return {
      minimum,
      predicate: {
        column: normalizedColumn,
        op: "ge",
        value: minimum,
      },
      ordering: {
        column: normalizedColumn,
        order: ordering,
      },
    }
  }

  return {
    levels: normalized as ReadonlyArray<Levels[number]>,
    ordering,
    atLeast(tier) {
      const index = findIndex(tier)
      return normalized.slice(index) as ReadonlyArray<Levels[number]>
    },
    source,
  }
}

export type AtLeastGrant<Tier extends string> = {
  kind: "at-least"
  tier: Tier
}

export type ReadScopeGrant = {
  kind: "read-scope"
}

export type DenyGrant = {
  kind: "deny"
}

export const grant = {
  atLeast<Tier extends string>(tier: Tier): AtLeastGrant<Tier> {
    const normalized = tier.trim()
    if (normalized.length === 0) {
      throw new Error("grant tier is required")
    }
    return { kind: "at-least", tier: normalized as Tier }
  },
  readScope(): ReadScopeGrant {
    return { kind: "read-scope" }
  },
  deny(): DenyGrant {
    return { kind: "deny" }
  },
}

export type ScopePath<Resource, Scope> = (
  resource: Term<Resource>,
  scope: Term<Scope>,
) => Rule

export function through<Resource, Scope>(
  relation: Relation<Resource, Scope>,
): ScopePath<Resource, Scope>
export function through<Resource, Step1, Scope>(
  relation1: Relation<Resource, Step1>,
  relation2: Relation<Step1, Scope>,
): ScopePath<Resource, Scope>
export function through<Resource, Step1, Step2, Scope>(
  relation1: Relation<Resource, Step1>,
  relation2: Relation<Step1, Step2>,
  relation3: Relation<Step2, Scope>,
): ScopePath<Resource, Scope>
export function through<Resource, Step1, Step2, Step3, Scope>(
  relation1: Relation<Resource, Step1>,
  relation2: Relation<Step1, Step2>,
  relation3: Relation<Step2, Step3>,
  relation4: Relation<Step3, Scope>,
): ScopePath<Resource, Scope>
export function through(
  ...relations: ReadonlyArray<Relation<unknown, unknown>>
): ScopePath<unknown, unknown> {
  if (relations.length === 0) {
    throw new Error("through requires at least one relation")
  }

  return (resource, scope) => {
    const steps: Array<Rule> = []
    let current: Term<unknown> = resource as unknown as Term<unknown>

    relations.forEach((entry, index) => {
      const isLast = index === relations.length - 1
      const next: Term<unknown> = isLast
        ? (scope as unknown as Term<unknown>)
        : term<unknown>(`rebac.path.${index}`)
      steps.push(
        (entry as unknown as Relation<unknown, unknown>)(current, next),
      )
      current = next
    })

    return and(...steps)
  }
}

export const either = <Resource, Scope>(
  ...paths: ReadonlyArray<ScopePath<Resource, Scope>>
): ScopePath<Resource, Scope> => {
  requirePath(paths as ReadonlyArray<AnyScopePath>, "either")
  return (resource, scope) => or(...paths.map(path => path(resource, scope)))
}

type GrantTerms<Actor, Resource, Scope, ReadScope> = {
  actor: Term<Actor>
  resource: Term<Resource>
  scope: Term<Scope>
  readScope?: Term<ReadScope>
}

export type GrantDefinition<
  Actor,
  Resource,
  Scope,
  ReadScope,
  Tier extends string,
> =
  | AtLeastGrant<Tier>
  | ReadScopeGrant
  | DenyGrant
  | Rule
  | ((terms: GrantTerms<Actor, Resource, Scope, ReadScope>) => Rule)

export interface ScopedPolicyOptions<
  Actor,
  Scope,
  ReadScope,
  Resources extends Record<string, unknown>,
  Action extends string,
  Tier extends string,
> {
  actor: Term<Actor>
  scope: Term<Scope>
  membership: {
    relation: Relation<Actor, Scope>
    roleColumn: string
    tiers: RoleTiers<Tier>
  }
  resources: {
    [K in keyof Resources]:
      | ScopePath<Resources[K], Scope>
      | ResourceType<Resources[K], Scope, any>
  }
  grants: Record<
    Action,
    GrantDefinition<Actor, Resources[keyof Resources], Scope, ReadScope, Tier>
  >
  readScope?: {
    via: ScopePath<Scope, ReadScope>
    membership: Relation<Actor, ReadScope>
  }
  overrides?: Partial<{
    [ResourceType in keyof Resources]: Partial<
      Record<
        Action,
        GrantDefinition<Actor, Resources[ResourceType], Scope, ReadScope, Tier>
      >
    >
  }>
  /**
   * Optional bypass rule evaluated before the normal per-action rule.
   * When it evaluates to `true`, access is granted regardless of membership.
   * Only applied for resources declared as `resourceType(...)` (requires
   * `resource.exists()` to be meaningful).
   */
  bypass?: (context: {
    resource: Pick<ResourceType<any, any, any>, "exists" | "ownedBy" | "term">
  }) => Rule
  evaluator?: EvaluatorInstance<Environment>
}

export interface ScopedPolicy<
  Actor,
  Scope,
  ReadScope,
  Resources extends Record<string, unknown>,
  Action extends string,
  Tier extends string,
> {
  readonly actor: Term<Actor>
  readonly scope: Term<Scope>
  readonly readScope?: Term<ReadScope>
  readonly resourceTerms: {
    [ResourceType in keyof Resources]: Term<Resources[ResourceType]>
  }
  ruleFor<ResourceType extends keyof Resources>(
    action: Action,
    resourceType: ResourceType,
  ): Rule
  roleRequirementFor<ResourceType extends keyof Resources>(
    action: Action,
    resourceType: ResourceType,
  ): RoleTierRequirement<Tier> | undefined
  sourceFor<ResourceType extends keyof Resources, TSource extends SourceShape>(
    action: Action,
    resourceType: ResourceType,
    source: TSource,
  ): TSource
  can<ResourceType extends keyof Resources>(
    actor: Actor,
    action: Action,
    resourceType: ResourceType,
    resource: Resources[ResourceType],
    options?: {
      environment?: Environment
      facts?: Readonly<Record<PropertyKey, unknown>>
    },
  ): Promise<boolean>
}

type SourceShape = {
  predicates?: ReadonlyArray<SourcePredicate>
  orderings?: ReadonlyArray<SourceOrdering>
}

type CompiledEntry<Tier extends string> = {
  rule: Rule
  requirement?: RoleTierRequirement<Tier>
}

const appendUniquePredicate = (
  predicates: ReadonlyArray<SourcePredicate> | undefined,
  predicate: SourcePredicate,
): Array<SourcePredicate> => {
  const existing = predicates ?? []
  const duplicate = existing.some(entry => {
    if (entry.column !== predicate.column || entry.op !== predicate.op) {
      return false
    }
    if (entry.op === "in" && predicate.op === "in") {
      return JSON.stringify(entry.values) === JSON.stringify(predicate.values)
    }
    if (entry.op !== "in" && predicate.op !== "in") {
      return Object.is(entry.value, predicate.value)
    }
    return false
  })
  return duplicate ? [...existing] : [...existing, predicate]
}

const appendUniqueOrdering = (
  orderings: ReadonlyArray<SourceOrdering> | undefined,
  ordering: SourceOrdering,
): Array<SourceOrdering> => {
  const existing = orderings ?? []
  const duplicate = existing.some(entry => {
    return (
      entry.column === ordering.column &&
      JSON.stringify(entry.order) === JSON.stringify(ordering.order)
    )
  })
  return duplicate ? [...existing] : [...existing, ordering]
}

export const scopedPolicy = <
  Actor,
  Scope,
  Resources extends Record<string, unknown>,
  Action extends string,
  Tier extends string,
  ReadScope = Scope,
>(
  options: ScopedPolicyOptions<
    Actor,
    Scope,
    ReadScope,
    Resources,
    Action,
    Tier
  >,
): ScopedPolicy<Actor, Scope, ReadScope, Resources, Action, Tier> => {
  const resourceTypes = Object.keys(options.resources) as Array<keyof Resources>
  const actions = Object.keys(options.grants) as Array<Action>
  const compiled = new Map<string, CompiledEntry<Tier>>()
  const resourceTerms = {} as {
    [ResourceType in keyof Resources]: Term<Resources[ResourceType]>
  }
  const readScopeTerm = options.readScope
    ? term<ReadScope>("rebac.read-scope")
    : undefined

  const resolveKey = (action: Action, resourceType: keyof Resources): string =>
    `${String(resourceType)}::${action}`

  resourceTypes.forEach(resourceType => {
    const entry = options.resources[resourceType]
    let resourceTerm: Term<Resources[typeof resourceType]>
    let toScope: ScopePath<Resources[typeof resourceType], Scope>

    if (isResourceType(entry)) {
      resourceTerm = entry.term as Term<Resources[typeof resourceType]>
      toScope = entry._owner as ScopePath<Resources[typeof resourceType], Scope>
    } else {
      resourceTerm = term<Resources[typeof resourceType]>(
        `rebac.resource.${String(resourceType)}`,
      )
      toScope = entry as ScopePath<Resources[typeof resourceType], Scope>
    }

    resourceTerms[resourceType] = resourceTerm

    actions.forEach(action => {
      const override = options.overrides?.[resourceType]?.[action]
      const definition =
        override ??
        (options.grants[action] as GrantDefinition<
          Actor,
          Resources[typeof resourceType],
          Scope,
          ReadScope,
          Tier
        >)
      const base = toScope(resourceTerm, options.scope)
      let compiled_entry: CompiledEntry<Tier>

      if (isAtLeastGrant<Tier>(definition)) {
        const requirement = options.membership.tiers.source(
          options.membership.roleColumn,
          definition.tier,
        )
        compiled_entry = {
          requirement,
          rule: and(
            base,
            options.membership.relation(options.actor, options.scope, {
              predicates: [requirement.predicate],
              orderings: [requirement.ordering],
            }),
          ),
        }
      } else if (isReadScopeGrant(definition)) {
        if (!options.readScope || !readScopeTerm) {
          throw new Error(
            `grant.readScope() requires readScope config (resource=${String(resourceType)}, action=${action})`,
          )
        }
        compiled_entry = {
          rule: and(
            base,
            options.readScope.via(options.scope, readScopeTerm),
            options.readScope.membership(options.actor, readScopeTerm),
          ),
        }
      } else if (isDenyGrant(definition)) {
        compiled_entry = {
          rule: and(base, { type: "not", child: base }),
        }
      } else {
        const customRule =
          typeof definition === "function"
            ? definition({
                actor: options.actor,
                resource: resourceTerm,
                scope: options.scope,
                readScope: readScopeTerm,
              })
            : definition

        if (!isRule(customRule)) {
          throw new Error(
            `custom grant must resolve to a core rule (resource=${String(resourceType)}, action=${action})`,
          )
        }

        compiled_entry = {
          rule: and(base, customRule),
        }
      }

      // Apply bypass: when the resource entry is a ResourceType and a bypass
      // function is provided, OR it in so that admin-level rules can short-circuit
      // the normal ownership check.
      if (options.bypass && isResourceType(entry)) {
        const bypassRule = options.bypass({ resource: entry })
        compiled_entry = {
          ...compiled_entry,
          rule: or(bypassRule, compiled_entry.rule),
        }
      }

      compiled.set(resolveKey(action, resourceType), compiled_entry)
    })
  })

  const getEntry = (
    action: Action,
    resourceType: keyof Resources,
  ): CompiledEntry<Tier> => {
    const entry = compiled.get(resolveKey(action, resourceType))
    if (!entry) {
      throw new Error(
        `no compiled grant for resource=${String(resourceType)} action=${action}`,
      )
    }
    return entry
  }

  return {
    actor: options.actor,
    scope: options.scope,
    readScope: readScopeTerm,
    resourceTerms,
    ruleFor(action, resourceType) {
      return getEntry(action, resourceType).rule
    },
    roleRequirementFor(action, resourceType) {
      return getEntry(action, resourceType).requirement
    },
    sourceFor<
      ResourceType extends keyof Resources,
      TSource extends SourceShape,
    >(action: Action, resourceType: ResourceType, source: TSource): TSource {
      const requirement = getEntry(action, resourceType).requirement
      if (!requirement) {
        return source
      }
      return {
        ...source,
        predicates: appendUniquePredicate(
          source.predicates,
          requirement.predicate,
        ),
        orderings: appendUniqueOrdering(source.orderings, requirement.ordering),
      }
    },
    async can(actor, action, resourceType, resource, runtimeOptions) {
      if (!options.evaluator) {
        throw new Error(
          "scopedPolicy.can requires options.evaluator; use ruleFor(...) when evaluating manually",
        )
      }
      const resourceEntry = options.resources[resourceType]
      const resourceEnv: Environment = isResourceType(resourceEntry)
        ? resourceEntry.bind(resource as any)
        : { [resourceTerms[resourceType]]: resource }
      const input: Environment = {
        ...(runtimeOptions?.environment ?? {}),
        [options.actor]: actor,
        ...resourceEnv,
      }
      const evaluationInput: EvaluationInput<Environment> =
        runtimeOptions?.facts
          ? { ...input, facts: runtimeOptions.facts }
          : input
      return options.evaluator.evaluate(
        getEntry(action, resourceType).rule,
        evaluationInput,
      )
    },
  }
}

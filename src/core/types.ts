export type MaybePromise<T> = T | Promise<T>

export interface RelationTuple {
  subject: string
  relation: string
  object: string
}

export type RelationValue = RelationTuple | Array<RelationTuple>
export type RelationInput<Context> =
  | RelationValue
  | ((context: Context) => MaybePromise<RelationValue>)
export type WherePredicate<Context, Deps> = (
  context: Context,
  deps: Deps,
) => MaybePromise<boolean>

export interface AbilityOptions<Context, Deps> {
  description?: string
  where?: WherePredicate<Context, Deps> | Array<WherePredicate<Context, Deps>>
  relation?: RelationInput<Context> | Array<RelationInput<Context>>
  meta?: Record<string, unknown>
  strictness?: string
}

export interface RebacDeps {
  hasRelation?: RelationResolver<any>
}

export type RelationResolver<Deps extends RebacDeps> = (
  tuple: RelationTuple,
  deps: Deps,
) => MaybePromise<boolean>

export interface AbilityDefinition<Context, Deps extends RebacDeps> {
  name: string
  description?: string
  where: Array<WherePredicate<Context, Deps>>
  relation: Array<RelationInput<Context>>
  meta?: Record<string, unknown>
  strictness?: string
}

export type Node<Context, Deps extends RebacDeps> =
  | { type: "ability"; definition: AbilityDefinition<Context, Deps> }
  | { type: "or"; children: Array<Node<Context, Deps>> }
  | { type: "and"; children: Array<Node<Context, Deps>> }
  | { type: "not"; child: Node<Context, Deps> }

export interface AbilityInstance<Context, Deps extends RebacDeps> {
  readonly kind: "ability"
  readonly name: string
  readonly description?: string
  can(context: Context, deps?: Deps): Promise<boolean>
  readonly __node: Node<Context, Deps>
}

export interface PolicyInstance<Context, Deps extends RebacDeps> {
  readonly kind: "policy"
  can(context: Context, deps?: Deps): Promise<boolean>
  readonly __node: Node<Context, Deps>
}

export type Composable<Context, Deps extends RebacDeps> =
  | AbilityInstance<Context, Deps>
  | PolicyInstance<Context, Deps>

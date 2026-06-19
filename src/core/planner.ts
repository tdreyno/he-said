import {
  AbilityDefinition,
  Node,
  RebacDeps,
  RelationInput,
  RelationTuple,
  RelationValue,
} from "./types"
import { andTask, from, notTask, orTask, Task } from "./task"

const toArray = <T>(value: T | Array<T>): Array<T> =>
  Array.isArray(value) ? value : [value]

const resolveRelationValue = async <Context>(
  relationInput: RelationInput<Context>,
  context: Context,
): Promise<Array<RelationTuple>> => {
  const value =
    typeof relationInput === "function"
      ? await relationInput(context)
      : relationInput

  return toArray(value as RelationValue)
}

const planRelation = <Context, Deps extends RebacDeps>(
  relationInput: RelationInput<Context>,
  context: Context,
  deps: Deps,
): Task<boolean> =>
  from(async () => {
    if (!deps?.hasRelation) {
      return false
    }

    const tuples = await resolveRelationValue(relationInput, context)
    const checks = await Promise.all(
      tuples.map(tuple => deps.hasRelation!(tuple, deps)),
    )

    return checks.every(Boolean)
  })

const planAbility = <Context, Deps extends RebacDeps>(
  definition: AbilityDefinition<Context, Deps>,
  context: Context,
  deps: Deps,
): Task<boolean> => {
  const whereTasks = definition.where.map(predicate =>
    from(async () => predicate(context, deps)),
  )

  const relationTasks = definition.relation.map(relationInput =>
    planRelation(relationInput, context, deps),
  )

  return andTask([...whereTasks, ...relationTasks])
}

export const plan = <Context, Deps extends RebacDeps>(
  node: Node<Context, Deps>,
  context: Context,
  deps: Deps,
): Task<boolean> => {
  switch (node.type) {
    case "ability":
      return planAbility(node.definition, context, deps)
    case "or":
      return orTask(node.children.map(child => plan(child, context, deps)))
    case "and":
      return andTask(node.children.map(child => plan(child, context, deps)))
    case "not":
      return notTask(plan(node.child, context, deps))
    default: {
      const _never: never = node
      return _never
    }
  }
}

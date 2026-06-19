import { createPolicyInstance } from "./instance"
import { Composable, PolicyInstance, RebacDeps } from "./types"

export const or = <Context, Deps extends RebacDeps>(
  ...abilities: Array<Composable<Context, Deps>>
): PolicyInstance<Context, Deps> => {
  return createPolicyInstance({
    type: "or",
    children: abilities.map(abilityItem => abilityItem.__node),
  })
}

export const and = <Context, Deps extends RebacDeps>(
  ...abilities: Array<Composable<Context, Deps>>
): PolicyInstance<Context, Deps> => {
  return createPolicyInstance({
    type: "and",
    children: abilities.map(abilityItem => abilityItem.__node),
  })
}

export const not = <Context, Deps extends RebacDeps>(
  abilityItem: Composable<Context, Deps>,
): PolicyInstance<Context, Deps> => {
  return createPolicyInstance({
    type: "not",
    child: abilityItem.__node,
  })
}

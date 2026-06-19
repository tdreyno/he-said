import { executeCan } from "./executor"
import { AbilityInstance, Node, PolicyInstance, RebacDeps } from "./types"

export const createAbilityInstance = <Context, Deps extends RebacDeps>(
  name: string,
  description: string | undefined,
  node: Node<Context, Deps>,
): AbilityInstance<Context, Deps> => {
  return {
    kind: "ability",
    name,
    description,
    __node: node,
    can(context, deps) {
      const safeDeps = (deps ?? {}) as Deps
      return executeCan(node, context, safeDeps)
    },
  }
}

export const createPolicyInstance = <Context, Deps extends RebacDeps>(
  node: Node<Context, Deps>,
): PolicyInstance<Context, Deps> => {
  return {
    kind: "policy",
    __node: node,
    can(context, deps) {
      const safeDeps = (deps ?? {}) as Deps
      return executeCan(node, context, safeDeps)
    },
  }
}

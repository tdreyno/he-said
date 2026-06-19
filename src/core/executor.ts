import { interpret } from "./interpreter"
import { plan } from "./planner"
import { Node, RebacDeps } from "./types"

export const executeCan = async <Context, Deps extends RebacDeps>(
  node: Node<Context, Deps>,
  context: Context,
  deps: Deps,
): Promise<boolean> => {
  const task = plan(node, context, deps)
  return interpret(task)
}

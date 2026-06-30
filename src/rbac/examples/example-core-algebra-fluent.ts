/**
 * RBAC example with a core-algebra fluent policy gate.
 *
 * RBAC decides role permissions first, then a core algebra rule composes
 * contextual safeguards (network, break-glass) around that result.
 */

import { createInMemoryAdapter } from "../../core/algebra-inmemory"
import { and, evaluator, not, or, term } from "../../core/algebra"
import { enforcer, policy, resource, role } from "../index"

type RequestContext = {
  readonly network: "corp" | "public"
  readonly breakGlass: boolean
}

type EvalEnvironment = {
  readonly request: RequestContext
  readonly baseAllowed: boolean
}

async function run(): Promise<void> {
  const document = resource<"document">()

  const editor = role()
    .permission("read", document)
    .permission("write", document)

  const rbac = enforcer(policy([editor], []))
  await rbac.roles(editor.id).grant("alice")

  const baseDecision = await rbac.enforce("alice", document, "write")

  const requestTerm = term<RequestContext>()
  const baseAllowedTerm = term<boolean>()

  const fromCorporateNetwork = requestTerm.is(
    request => request.network === "corp",
  )
  const breakGlassDisabled = requestTerm.is(
    request => request.breakGlass === false,
  )

  const guardedPolicy = and(
    baseAllowedTerm.is(allowed => allowed),
    or(fromCorporateNetwork, not(breakGlassDisabled)),
  )

  const evalInstance = evaluator(createInMemoryAdapter({ relations: [] }), {
    evaluatorContext: undefined,
  })

  const finalAllowed = await evalInstance.evaluate(guardedPolicy, {
    [requestTerm]: {
      network: "corp",
      breakGlass: false,
    },
    [baseAllowedTerm]: baseDecision.allowed,
  } as EvalEnvironment)

  console.log("baseAllowed:", baseDecision.allowed)
  console.log("finalAllowed:", finalAllowed)
}

void run()

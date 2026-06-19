import {
  algebra,
  eq,
  evaluator,
  forAll,
  is,
  memo,
  ref,
  relation,
  term,
  type Environment,
} from "../src"

type User = { id: string; suspended: boolean }
type Team = { id: string }

type Env = Environment & {
  tenant: string
}

const viewer = term<User>()
const team = term<Team>()
const tenant = term<string>()

const memberOf = relation<User, Team>()

const activeViewer = is(viewer, (value, env: Env) => {
  return !value.suspended && typeof env.tenant === "string"
})

memberOf(activeViewer, team)

// @ts-expect-error wrong term type for relation left
memberOf(team, team)

eq(tenant, "acme")

// @ts-expect-error eq term mismatch
eq(tenant, viewer)

const baseRule = algebra.and(
  team,
  memberOf(activeViewer, team),
  eq(tenant, "acme"),
)

forAll(team, baseRule)
memo("tenant-rule", baseRule)
ref("tenant-rule")

const adapter = {
  evaluate: async () => true,
}

const instance = evaluator(adapter, {
  evaluatorContext: null,
})

instance.evaluate(baseRule, {
  [viewer]: { id: "u1", suspended: false },
  [tenant]: "acme",
})

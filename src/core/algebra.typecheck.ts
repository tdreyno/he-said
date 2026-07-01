import {
  algebra,
  eq,
  evaluator,
  fact,
  factIsTrue,
  forAll,
  implies,
  letRule,
  ref,
  relation,
  term,
  type Environment,
} from ".."

type User = { id: string; suspended: boolean }
type Team = { id: string }

type Env = Environment & {
  tenant: string
}

const viewer = term<User>()
const team = term<Team>()
const tenant = term<string>()
const isAppAdmin = fact<boolean>()

const memberOf = relation<User, Team>()

const activeViewer = viewer.is((value, env: Env) => {
  return !value.suspended && typeof env.tenant === "string"
})

memberOf(activeViewer, team)

// @ts-expect-error wrong term type for relation left
memberOf(team, team)

eq(tenant, "acme")
factIsTrue(isAppAdmin)

// @ts-expect-error eq term mismatch
eq(tenant, viewer)

const baseRule = algebra.and(
  team,
  memberOf(activeViewer, team),
  eq(tenant, "acme"),
)

forAll(team, baseRule)
implies(baseRule, team)
letRule("tenant-rule", baseRule)
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

instance.evaluate(factIsTrue(isAppAdmin), {
  facts: {
    [isAppAdmin]: true,
  },
})

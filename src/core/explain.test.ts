import {
  and,
  annotateRule,
  createInMemoryAdapter,
  evaluator,
  exists,
  explainAllow,
  fact,
  factIsTrue,
  or,
  relation,
  term,
} from ".."
import type { Environment, EvaluatorAdapter } from "./algebra"
import { associates, belongsTo } from "./algebra-postgres-helpers"

describe("explainAllow", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const orgT = term<string>("org")
  const isAppAdmin = fact<boolean>("isAppAdmin")

  const memberOfTeam = relation<string, string>(undefined, "memberOfTeam")
  const teamInOrg = relation<string, string>(undefined, "teamInOrg")

  const engine = evaluator(
    createInMemoryAdapter({
      relationMappings: [
        {
          relation: memberOfTeam,
          source: associates({
            table: "team_members",
            left: "user_id",
            right: "team_id",
          }),
        },
        {
          relation: teamInOrg,
          source: belongsTo({ table: "teams", fk: "org_id" }),
        },
      ],
      termDomains: [{ term: teamT, table: "teams", valueColumn: "id" }],
      seed: {
        teams: [{ id: "team-a", org_id: "org-1" }],
        team_members: [{ user_id: "alice", team_id: "team-a" }],
      },
    }) as EvaluatorAdapter<Environment, null>,
    { evaluatorContext: null },
  )

  const adminBranch = annotateRule(and(factIsTrue(isAppAdmin), exists(teamT)), {
    label: "app admin",
  })
  const memberBranch = annotateRule(
    and(memberOfTeam(actor, teamT), teamInOrg(teamT, orgT)),
    { label: "org member" },
  )
  const rule = or(adminBranch, memberBranch)

  it("reports the winning OR branch by label", async () => {
    const explanation = await explainAllow(engine, rule, {
      [actor]: "alice",
      [teamT]: "team-a",
      [orgT]: "org-1",
      facts: { [isAppAdmin]: false },
    })

    expect(explanation.ok).toBe(true)
    if (explanation.ok) {
      expect(explanation.choices).toHaveLength(1)
      expect(explanation.choices[0]).toMatchObject({
        index: 1,
        label: "org member",
      })
    }
  })

  it("prefers the earlier alternative when both pass", async () => {
    const explanation = await explainAllow(engine, rule, {
      [actor]: "alice",
      [teamT]: "team-a",
      [orgT]: "org-1",
      facts: { [isAppAdmin]: true },
    })

    expect(explanation.ok).toBe(true)
    if (explanation.ok) {
      expect(explanation.choices[0]).toMatchObject({
        index: 0,
        label: "app admin",
      })
    }
  })

  it("returns ok: false without probing when the rule denies", async () => {
    const explanation = await explainAllow(engine, rule, {
      [actor]: "mallory",
      [teamT]: "team-a",
      [orgT]: "org-1",
      facts: { [isAppAdmin]: false },
    })

    expect(explanation).toEqual({ ok: false })
  })

  it("descends into nested ORs, reporting choices outermost first", async () => {
    const inner = or(
      annotateRule(memberOfTeam(actor, teamT), { label: "direct member" }),
      annotateRule(teamInOrg(teamT, orgT), { label: "org path" }),
    )
    const nested = or(
      annotateRule(factIsTrue(isAppAdmin), { label: "admin" }),
      annotateRule(and(exists(teamT), inner), { label: "team path" }),
    )

    const explanation = await explainAllow(engine, nested, {
      [actor]: "alice",
      [teamT]: "team-a",
      [orgT]: "org-1",
      facts: { [isAppAdmin]: false },
    })

    expect(explanation.ok).toBe(true)
    if (explanation.ok) {
      expect(explanation.choices.map(choice => choice.label)).toEqual([
        "team path",
        "direct member",
      ])
    }
  })

  it("summarizes unannotated branches structurally", async () => {
    const bare = or(
      and(factIsTrue(isAppAdmin), exists(teamT)),
      memberOfTeam(actor, teamT),
    )

    const explanation = await explainAllow(engine, bare, {
      [actor]: "alice",
      [teamT]: "team-a",
      facts: { [isAppAdmin]: false },
    })

    expect(explanation.ok).toBe(true)
    if (explanation.ok) {
      expect(explanation.choices[0]!.label).toBe("memberOfTeam")
    }
  })
})

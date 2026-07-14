import {
  and,
  bindEnvironment,
  createInMemoryAdapter,
  evaluator,
  exists,
  fact,
  factIsTrue,
  or,
  relation,
  term,
} from ".."
import type { Environment, EvaluatorAdapter } from "./algebra"
import { associates } from "./algebra-postgres-helpers"

describe("bindEnvironment (principal pre-binding)", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const isAdmin = fact<boolean>("isAdmin")

  const memberOf = relation<string, string>(undefined, "memberOf")

  const engine = evaluator(
    createInMemoryAdapter({
      relationMappings: [
        {
          relation: memberOf,
          source: associates({
            table: "team_members",
            left: "user_id",
            right: "team_id",
          }),
        },
      ],
      termDomains: [{ term: teamT, table: "teams", valueColumn: "id" }],
      seed: {
        teams: [{ id: "team-a" }],
        team_members: [{ user_id: "alice", team_id: "team-a" }],
      },
    }) as EvaluatorAdapter<Environment, null>,
    { evaluatorContext: null },
  )

  const rule = or(
    and(factIsTrue(isAdmin), exists(teamT)),
    memberOf(actor, teamT),
  )

  it("supplies the principal bindings on every check", async () => {
    const asAlice = bindEnvironment(engine, {
      [actor]: "alice",
      facts: { [isAdmin]: false },
    })

    await expect(asAlice.evaluate(rule, { [teamT]: "team-a" })).resolves.toBe(
      true,
    )
    await expect(asAlice.evaluate(rule, { [teamT]: "team-b" })).resolves.toBe(
      false,
    )
  })

  it("merges facts bags, call-site bindings winning", async () => {
    const asMallory = bindEnvironment(engine, {
      [actor]: "mallory",
      facts: { [isAdmin]: false },
    })

    // deny as plain mallory…
    await expect(asMallory.evaluate(rule, { [teamT]: "team-a" })).resolves.toBe(
      false,
    )
    // …but a per-call fact override wins
    await expect(
      asMallory.evaluate(rule, {
        [teamT]: "team-a",
        facts: { [isAdmin]: true },
      }),
    ).resolves.toBe(true)
  })

  it("threads the base environment through filter()", async () => {
    const asAlice = bindEnvironment(engine, {
      [actor]: "alice",
      facts: { [isAdmin]: false },
    })

    const readable = await asAlice.filter<string>(rule, {
      environment: {},
      term: teamT,
      candidates: ["team-a", "team-b"],
    })

    expect([...readable]).toEqual(["team-a"])
  })

  it("proofs run with the merged environment", async () => {
    const asAlice = bindEnvironment(engine, {
      [actor]: "alice",
      facts: { [isAdmin]: false },
    })

    const proof = await asAlice.evaluateWithProof(rule, { [teamT]: "team-a" })
    expect(proof.ok).toBe(true)
  })
})

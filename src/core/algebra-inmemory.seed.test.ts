import {
  and,
  createInMemoryAdapter,
  evaluator,
  exists,
  relation,
  term,
} from ".."
import { associates, belongsTo } from "./algebra-postgres-helpers"
import { relationWithSource } from "./self-describing"
import type { Environment, EvaluatorAdapter, Rule } from "./algebra"

const instance = (adapter: EvaluatorAdapter<Environment, unknown>) =>
  evaluator(adapter as EvaluatorAdapter<Environment, null>, {
    evaluatorContext: null,
  })

/**
 * Seed mode: the SAME relation mappings production compiles to SQL, evaluated
 * over seeded table rows. Source predicates apply to the seed — no restated
 * fixture facts to drift.
 */
describe("in-memory adapter — seed mode", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const systemT = term<string>("system")

  const memberOfTeam = relation<string, string>()
  const editorOfTeam = relation<string, string>()
  const orgSharedSystemInTeam = relation<string, string>()

  const relationMappings = [
    {
      relation: memberOfTeam,
      source: associates({
        table: "team_members",
        left: "user_id",
        right: "team_id",
      }),
    },
    {
      relation: editorOfTeam,
      source: associates({
        table: "team_members",
        left: "user_id",
        right: "team_id",
        predicates: [
          { column: "role", op: "in", values: ["editor", "admin", "owner"] },
        ],
      }),
    },
    {
      relation: orgSharedSystemInTeam,
      source: belongsTo({
        table: "systems",
        pk: "id",
        fk: "team_id",
        predicates: [{ column: "org_access", op: "in", values: ["read"] }],
      }),
    },
  ]

  const seed = {
    teams: [{ id: "team-a" }, { id: "team-b" }],
    team_members: [
      { user_id: "alice", team_id: "team-a", role: "editor" },
      { user_id: "bob", team_id: "team-a", role: "viewer" },
    ],
    systems: [
      { id: "sys-shared", team_id: "team-a", org_access: "read" },
      { id: "sys-private", team_id: "team-a", org_access: "none" },
    ],
  }

  const engine = instance(createInMemoryAdapter({ relationMappings, seed }))

  const evaluate = (rule: Rule, env: Environment) => engine.evaluate(rule, env)

  it("derives membership pairs from seeded rows", async () => {
    await expect(
      evaluate(memberOfTeam(actor, teamT), {
        [actor]: "alice",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(true)

    await expect(
      evaluate(memberOfTeam(actor, teamT), {
        [actor]: "alice",
        [teamT]: "team-b",
      }),
    ).resolves.toBe(false)
  })

  it("applies SOURCE predicates to the seed (no restated fixture facts)", async () => {
    await expect(
      evaluate(editorOfTeam(actor, teamT), {
        [actor]: "alice",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(true)

    // bob is a viewer — excluded by the production predicate, not by
    // fixture omission.
    await expect(
      evaluate(editorOfTeam(actor, teamT), {
        [actor]: "bob",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(false)
  })

  it("predicated edges yield rows only where the column matches", async () => {
    await expect(
      evaluate(orgSharedSystemInTeam(systemT, teamT), {
        [systemT]: "sys-shared",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(true)

    await expect(
      evaluate(orgSharedSystemInTeam(systemT, teamT), {
        [systemT]: "sys-private",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(false)
  })

  it("derives exists() domains from termDomains over the seed", async () => {
    const domainEngine = instance(
      createInMemoryAdapter({
        relationMappings,
        termDomains: [{ term: teamT, table: "teams", valueColumn: "id" }],
        seed,
      }),
    )

    await expect(
      domainEngine.evaluate(exists(teamT), { [teamT]: "team-a" }),
    ).resolves.toBe(true)

    await expect(
      domainEngine.evaluate(exists(teamT), { [teamT]: "team-ghost" }),
    ).resolves.toBe(false)
  })

  it("filters term-domain rows through domain predicates", async () => {
    const sharedOnly = instance(
      createInMemoryAdapter({
        relationMappings,
        termDomains: [
          {
            term: systemT,
            table: "systems",
            valueColumn: "id",
            predicates: [{ column: "org_access", op: "in", values: ["read"] }],
          },
        ],
        seed,
      }),
    )

    await expect(
      sharedOnly.evaluate(exists(systemT), { [systemT]: "sys-shared" }),
    ).resolves.toBe(true)

    await expect(
      sharedOnly.evaluate(exists(systemT), { [systemT]: "sys-private" }),
    ).resolves.toBe(false)
  })

  it("resolves self-describing relations without an explicit mapping entry", async () => {
    const selfDescribed = relationWithSource<string, string>(
      associates({ table: "team_members", left: "user_id", right: "team_id" }),
    )

    const engine2 = instance(
      createInMemoryAdapter({
        relationMappings: [selfDescribed],
        seed,
      }),
    )

    await expect(
      engine2.evaluate(selfDescribed(actor, teamT), {
        [actor]: "alice",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(true)
  })

  it("ignores rows with NULL join columns, like a SQL join", async () => {
    const engine3 = instance(
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
        ],
        seed: {
          team_members: [{ user_id: "carol", team_id: null, role: "editor" }],
        },
      }),
    )

    await expect(
      engine3.evaluate(memberOfTeam(actor, teamT), {
        [actor]: "carol",
        [teamT]: null,
      }),
    ).resolves.toBe(false)
  })

  it("accepts schema-qualified source tables against bare seed keys", async () => {
    const qualified = relationWithSource<string, string>(
      associates({
        table: "public.team_members",
        left: "user_id",
        right: "team_id",
      }),
    )

    const engine4 = instance(
      createInMemoryAdapter({
        relationMappings: [qualified],
        seed,
      }),
    )

    await expect(
      engine4.evaluate(qualified(actor, teamT), {
        [actor]: "alice",
        [teamT]: "team-a",
      }),
    ).resolves.toBe(true)
  })

  it("fails loud on staticFilters (raw SQL is not evaluable in memory)", () => {
    expect(() =>
      createInMemoryAdapter({
        relationMappings: [
          {
            relation: memberOfTeam,
            source: {
              table: "team_members",
              leftColumn: "user_id",
              rightColumn: "team_id",
              staticFilters: [{ sql: "deleted_at IS NULL" }],
            },
          },
        ],
        seed,
      }),
    ).toThrow("staticFilters")
  })

  it("fails loud for relations with neither mapping nor attached source", () => {
    const bare = relation<string, string>()

    expect(() =>
      createInMemoryAdapter({ relationMappings: [bare], seed }),
    ).toThrow("requires a relation source")
  })

  it("composes with rule evaluation end-to-end (editor AND shared system)", async () => {
    await expect(
      evaluate(
        and(editorOfTeam(actor, teamT), orgSharedSystemInTeam(systemT, teamT)),
        { [actor]: "alice", [teamT]: "team-a", [systemT]: "sys-shared" },
      ),
    ).resolves.toBe(true)

    await expect(
      evaluate(
        and(editorOfTeam(actor, teamT), orgSharedSystemInTeam(systemT, teamT)),
        { [actor]: "bob", [teamT]: "team-a", [systemT]: "sys-shared" },
      ),
    ).resolves.toBe(false)
  })
})

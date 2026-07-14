import { and, exists, planPostgresRule, relation, term } from ".."
import { belongsTo } from "./algebra-postgres-helpers"
import {
  attachRelationSource,
  attachTermDomain,
  attachedRelationSource,
  attachedTermDomain,
  relationWithSource,
} from "./self-describing"
import { getTermInfo } from "./algebra"

describe("self-describing relations and terms", () => {
  it("attaches a source to a relation and resolves it by id", () => {
    const source = belongsTo({ table: "systems", fk: "team_id" })
    const rel = attachRelationSource(relation(), source)

    expect(attachedRelationSource(rel.id)).toBe(source)
  })

  it("relationWithSource declares and attaches in one step", () => {
    const source = belongsTo({ table: "branches", fk: "system_id" })
    const rel = relationWithSource(source)

    expect(typeof rel).toBe("function")
    expect(attachedRelationSource(rel.id)).toBe(source)
  })

  it("attaches a term domain and resolves it by root", () => {
    const teamT = attachTermDomain(term<string>("team"), {
      table: "teams",
      valueColumn: "id",
    })

    const root = getTermInfo(teamT).root as symbol
    expect(attachedTermDomain(root)).toMatchObject({
      table: "teams",
      valueColumn: "id",
    })
  })

  it("plans a rule with NO explicit mappings — discovery fills the gaps", () => {
    const systemT = attachTermDomain(term<string>("system"), {
      table: "systems",
      valueColumn: "id",
    })
    const teamT = term<string>("team")
    const systemInTeam = relationWithSource<string, string>(
      belongsTo({ table: "systems", fk: "team_id" }),
    )

    const plan = planPostgresRule(
      and(systemInTeam(systemT, teamT), exists(systemT)),
      {
        relationMappings: [],
        environment: { [systemT]: "sys-1", [teamT]: "team-1" },
      },
    )

    expect(plan.sql).toContain('"systems"')
    expect(plan.sql).toContain('"team_id"')
  })

  it("explicit adapter configuration wins over attached metadata", () => {
    const systemT = term<string>("system")
    const teamT = term<string>("team")
    const rel = relationWithSource<string, string>(
      belongsTo({ table: "wrong_table", fk: "team_id" }),
    )

    const plan = planPostgresRule(rel(systemT, teamT), {
      relationMappings: [
        {
          relation: rel,
          source: belongsTo({ table: "right_table", fk: "team_id" }),
        },
      ],
      environment: { [systemT]: "sys-1", [teamT]: "team-1" },
    })

    expect(plan.sql).toContain('"right_table"')
    expect(plan.sql).not.toContain('"wrong_table"')
  })

  it("still fails loud for relations with neither mapping nor metadata", () => {
    const a = term<string>("a")
    const b = term<string>("b")
    const bare = relation<string, string>()

    expect(() =>
      planPostgresRule(bare(a, b), {
        relationMappings: [],
        environment: { [a]: "1", [b]: "2" },
      }),
    ).toThrow("missing a relation mapping")
  })
})

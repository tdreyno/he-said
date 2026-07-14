import { and, exists, fact, factIsTrue, not, or, relation, term } from ".."
import { annotateRule } from "../core/algebra"
import {
  isRule,
  ruleToMermaid,
  rulesToMermaid,
  traceRuleToMermaid,
} from "./index"

describe("mermaid decision trees", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const workspaceT = term<string>("workspace")
  const isAppAdmin = fact<boolean>("isAppAdmin")

  const memberOfTeam = relation<string, string>()
  const teamInWorkspace = relation<string, string>()

  const relationNames = new Map<symbol, string>([
    [memberOfTeam.id, "memberOfTeam"],
    [teamInWorkspace.id, "teamInWorkspace"],
  ])

  const readRule = or(
    and(factIsTrue(isAppAdmin), exists(teamT)),
    and(
      teamInWorkspace(teamT, workspaceT),
      memberOfTeam(actor, teamT, {
        predicates: [
          { column: "role", op: "in", values: ["editor", "admin", "owner"] },
        ],
      }),
    ),
  )

  it("renders decisions with ALLOW/DENY outcomes", () => {
    const chart = ruleToMermaid(readRule, { relationNames })

    expect(chart).toContain("flowchart TD")
    expect(chart).toContain('(["ALLOW"]):::allow')
    expect(chart).toContain('(["DENY"]):::deny')
    expect(chart).toContain('{"isAppAdmin?"}')
    expect(chart).toContain('{"team exists?"}')
    expect(chart).toContain(
      "memberOfTeam: actor → team with role in ['editor', 'admin', 'owner']?",
    )
  })

  it("AND chains follow yes edges; failure falls through to the next OR branch", () => {
    const chart = ruleToMermaid(
      or(and(factIsTrue(isAppAdmin), exists(teamT)), exists(workspaceT)),
    )
    const lines = chart.split("\n")

    const idOf = (label: string) =>
      lines
        .find(line => line.includes(label))!
        .trim()
        .split("{")[0]!

    const admin = idOf("isAppAdmin?")
    const teamExists = idOf("team exists?")
    const wsExists = idOf("workspace exists?")

    // and: admin yes → team exists
    expect(chart).toContain(`${admin} -- yes --> ${teamExists}`)
    // or fall-through: both AND members fail into the second alternative
    expect(chart).toContain(`${admin} -- no --> ${wsExists}`)
    expect(chart).toContain(`${teamExists} -- no --> ${wsExists}`)
    // terminal wiring: n0=ALLOW, n1=DENY
    expect(chart).toContain(`${teamExists} -- yes --> n0`)
    expect(chart).toContain(`${wsExists} -- no --> n1`)
  })

  it("NOT swaps the yes/no targets", () => {
    const chart = ruleToMermaid(not(exists(teamT)))
    // n0=ALLOW, n1=DENY: negation sends yes to DENY, no to ALLOW
    expect(chart).toContain("-- yes --> n1")
    expect(chart).toContain("-- no --> n0")
  })

  it("uses rule annotations as label prefixes", () => {
    const annotated = annotateRule(exists(teamT), { label: "target row" })
    const chart = ruleToMermaid(annotated)

    expect(chart).toContain("target row: team exists?")
  })

  it("escapes double quotes in labels", () => {
    const quoted = term<string>('the "team"')
    const chart = ruleToMermaid(exists(quoted))

    expect(chart).toContain("#quot;team#quot;")
    expect(chart).not.toContain('""team""')
  })

  it("renders a named rule set with per-subgraph outcomes and unique ids", () => {
    const chart = rulesToMermaid(
      {
        read: readRule,
        manage: null,
        delete: memberOfTeam(actor, teamT),
      },
      { relationNames },
    )

    expect(chart).toContain('subgraph s0["read"]')
    expect(chart).toContain('subgraph s1["delete"]')
    expect(chart).not.toContain("manage")
    expect(chart.match(/\(\["ALLOW"\]\):::allow/g)).toHaveLength(2)
    expect(chart.match(/\(\["DENY"\]\):::deny/g)).toHaveLength(2)

    const ids = [...chart.matchAll(/^ {2}(n\d+)[[({]/gm)].map(match => match[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("isRule accepts algebra nodes and rejects everything else", () => {
    expect(isRule(readRule)).toBe(true)
    expect(isRule(exists(teamT))).toBe(true)
    expect(isRule({ type: "unrelated" })).toBe(false)
    expect(isRule(memberOfTeam)).toBe(false)
    expect(isRule(null)).toBe(false)
  })

  it("traceRuleToMermaid highlights the taken path to the terminal", async () => {
    const { createInMemoryAdapter, evaluator } = await import("..")
    const { associates } = await import("../core/algebra-postgres-helpers")

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
            relation: teamInWorkspace,
            source: associates({
              table: "teams",
              left: "id",
              right: "workspace_id",
            }),
          },
        ],
        termDomains: [{ term: teamT, table: "teams", valueColumn: "id" }],
        seed: {
          teams: [{ id: "team-a", workspace_id: "ws-1" }],
          team_members: [
            { user_id: "alice", team_id: "team-a", role: "editor" },
          ],
        },
      }) as never,
      { evaluatorContext: null },
    )

    const chart = await traceRuleToMermaid(
      engine as never,
      readRule,
      {
        [actor]: "alice",
        [teamT]: "team-a",
        [workspaceT]: "ws-1",
        facts: { [isAppAdmin]: false },
      },
      { relationNames },
    )

    // isAppAdmin fails (thin edge), fall-through route is thick, ends at ALLOW
    expect(chart).toContain("classDef path")
    expect(chart).toMatch(/n\d+ == no ==> n\d+/)
    expect(chart).toMatch(/n\d+ == yes ==> n0/)
    expect(chart).toMatch(/class n\d+(,n\d+)* path/)
    // the taken-path class list includes the ALLOW terminal (n0)
    expect(chart).toMatch(/class [^\n]*n0[^\n]* path|class n0[^\n]* path/)
  })
})

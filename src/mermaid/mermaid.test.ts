import { and, exists, fact, factIsTrue, not, or, relation, term } from ".."
import { annotateRule } from "../core/algebra"
import { isRule, ruleToMermaid, rulesToMermaid } from "./index"

describe("mermaid flow charts", () => {
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

  it("renders junctions, relations, predicates, facts, and existence", () => {
    const chart = ruleToMermaid(readRule, { relationNames })

    expect(chart).toContain("flowchart TD")
    expect(chart).toContain('{{"OR"}}')
    expect(chart).toContain('{{"AND"}}')
    expect(chart).toContain('(["exists(team)"])')
    expect(chart).toContain(
      "memberOfTeam(actor → team) [role in ['editor', 'admin', 'owner']]",
    )
    expect(chart).toContain("teamInWorkspace(team → workspace)")
    expect(chart).toContain("fact isAppAdmin")
  })

  it("falls back to generic labels for anonymous relations", () => {
    const chart = ruleToMermaid(memberOfTeam(actor, teamT))

    expect(chart).toContain("relation(actor → team)")
  })

  it("renders NOT with an edge to its child", () => {
    const chart = ruleToMermaid(not(exists(teamT)))

    expect(chart).toContain('n0{{"NOT"}}')
    expect(chart).toContain("n0 --> n1")
  })

  it("uses rule annotations as label prefixes", () => {
    const annotated = annotateRule(exists(teamT), { label: "target row" })
    const chart = ruleToMermaid(annotated)

    expect(chart).toContain("target row: exists(team)")
  })

  it("escapes double quotes in labels", () => {
    const quoted = term<string>('the "team"')
    const chart = ruleToMermaid(exists(quoted))

    expect(chart).toContain("#quot;team#quot;")
    expect(chart).not.toContain('""team""')
  })

  it("renders a named rule set as one flowchart with subgraphs", () => {
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
    // node ids stay unique across subgraphs
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
})

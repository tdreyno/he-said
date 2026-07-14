import { and, exists, fact, factIsTrue, not, or, relation, term } from ".."
import { analyzePolicy, ruleEquals } from "./analyze"

describe("analyzePolicy", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const wsT = term<string>("workspace")
  const isAdmin = fact<boolean>("isAdmin")

  const memberOf = relation<string, string>(undefined, "memberOf")
  const inWorkspace = relation<string, string>(undefined, "inWorkspace")
  const shared = relation<string, string>(undefined, "shared")

  it("finds OR alternatives subsumed by a more general sibling (dead grants)", () => {
    // The motivating shape: read = wsMember OR (wsMember AND shared) —
    // the second grant was dead code in production for months.
    const rule = or(
      and(inWorkspace(teamT, wsT), memberOf(actor, teamT)),
      and(inWorkspace(teamT, wsT), memberOf(actor, teamT), shared(teamT, wsT)),
    )

    const findings = analyzePolicy({ "System.read": rule })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: "subsumed-or-branch",
      rule: "System.read",
    })
    expect(findings[0]!.message).toContain("can never change a verdict")
  })

  it("finds duplicated OR alternatives once", () => {
    const branch = memberOf(actor, teamT)
    const findings = analyzePolicy(or(branch, memberOf(actor, teamT)))

    expect(findings).toHaveLength(1)
    expect(findings[0]!.kind).toBe("duplicate-branch")
  })

  it("does NOT flag the pure and(X, not(X)) never idiom (grant.deny)", () => {
    const base = memberOf(actor, teamT)
    const findings = analyzePolicy(and(base, not(memberOf(actor, teamT))))

    expect(findings).toHaveLength(0)
  })

  it("flags contradictions buried among other conjuncts", () => {
    const findings = analyzePolicy(
      and(exists(teamT), memberOf(actor, teamT), not(memberOf(actor, teamT))),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.kind).toBe("buried-contradiction")
  })

  it("reports declared relations no analyzed rule references", () => {
    const findings = analyzePolicy(
      { read: memberOf(actor, teamT) },
      { relations: [memberOf, inWorkspace] },
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: "unused-relation" })
    expect(findings[0]!.message).toContain("inWorkspace")
  })

  it("returns no findings for a clean policy", () => {
    const rule = or(
      and(factIsTrue(isAdmin), exists(teamT)),
      and(inWorkspace(teamT, wsT), memberOf(actor, teamT)),
    )

    expect(
      analyzePolicy({ read: rule }, { relations: [memberOf, inWorkspace] }),
    ).toHaveLength(0)
  })

  it("ruleEquals compares structurally, including predicates", () => {
    const a = memberOf(actor, teamT, {
      predicates: [{ column: "role", op: "in", values: ["editor"] }],
    })
    const b = memberOf(actor, teamT, {
      predicates: [{ column: "role", op: "in", values: ["editor"] }],
    })
    const c = memberOf(actor, teamT, {
      predicates: [{ column: "role", op: "in", values: ["viewer"] }],
    })

    expect(ruleEquals(a, b)).toBe(true)
    expect(ruleEquals(a, c)).toBe(false)
  })
})

import { and, exists, fact, factIsTrue, or, relation, term } from ".."
import { diffRules } from "./diff"

describe("diffRules", () => {
  const actor = term<string>("actor")
  const teamT = term<string>("team")
  const orgT = term<string>("org")
  const isAdmin = fact<boolean>("isAdmin")

  const memberOf = relation<string, string>(undefined, "memberOf")
  const teamInOrg = relation<string, string>(undefined, "teamInOrg")
  const orgShared = relation<string, string>(undefined, "orgShared")

  const adminBranch = and(factIsTrue(isAdmin), exists(teamT))
  const memberBranch = and(memberOf(actor, teamT))

  it("reports an added OR alternative in policy language", () => {
    const before = or(adminBranch, memberBranch)
    const after = or(
      adminBranch,
      memberBranch,
      and(orgShared(teamT, orgT), teamInOrg(teamT, orgT)),
    )

    const changes = diffRules(
      { "System.read": before },
      { "System.read": after },
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: "added-alternative",
      rule: "System.read",
    })
    expect(changes[0]!.message).toContain("orgShared")
  })

  it("reports removed alternatives", () => {
    const before = or(adminBranch, memberBranch)
    const after = or(adminBranch)

    const changes = diffRules(before, after)

    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe("removed-alternative")
    expect(changes[0]!.message).toContain("memberOf")
  })

  it("recurses into a single changed pair: tightened AND reads as added condition", () => {
    const before = or(adminBranch, and(memberOf(actor, teamT)))
    const after = or(
      adminBranch,
      and(memberOf(actor, teamT), teamInOrg(teamT, orgT)),
    )

    const changes = diffRules(before, after)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: "added-conjunct" })
    expect(changes[0]!.message).toContain("tightened")
    expect(changes[0]!.message).toContain("teamInOrg")
  })

  it("reports loosened grants when conditions disappear", () => {
    const before = and(memberOf(actor, teamT), teamInOrg(teamT, orgT))
    const after = and(memberOf(actor, teamT))

    const changes = diffRules(before, after)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: "removed-conjunct" })
    expect(changes[0]!.message).toContain("loosened")
  })

  it("reports added and removed named rules", () => {
    const changes = diffRules(
      { "Team.read": memberBranch },
      { "Org.read": memberBranch },
    )

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "removed-rule", rule: "Team.read" }),
        expect.objectContaining({ kind: "added-rule", rule: "Org.read" }),
      ]),
    )
  })

  it("returns no changes for structurally identical policies", () => {
    const a = or(adminBranch, and(memberOf(actor, teamT)))
    const b = or(
      and(factIsTrue(isAdmin), exists(teamT)),
      and(memberOf(actor, teamT)),
    )

    expect(diffRules({ read: a }, { read: b })).toHaveLength(0)
  })
})

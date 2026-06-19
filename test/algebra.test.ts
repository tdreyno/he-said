import {
  algebra,
  createInMemoryAdapter,
  distinct,
  eq,
  evaluator,
  forAll,
  is,
  memo,
  ref,
  relation,
  select,
  term,
  validateStratifiedNegation,
} from "../src"

type User = { id: string; suspended: boolean }
type Team = { id: string }
type Membership = { id: string }
type Document = { id: string; archived: boolean }

describe("algebra api", () => {
  it("executes existential and constrained rules with in-memory adapter", async () => {
    const viewer = term<User>()
    const team = term<Team>()
    const membership = term<Membership>()
    const document = term<Document>()
    const allowArchivedReads = term<boolean>()

    const userHasMembership = relation<User, Membership>()
    const membershipBelongsToTeam = relation<Membership, Team>()
    const teamOwnsDocument = relation<Team, Document>()

    const activeViewer = is(viewer, v => !v.suspended)
    const readableDocument = is(
      document,
      (d, env) => !d.archived || env[allowArchivedReads] === true,
    )

    const rule = algebra.and(
      team,
      membership,
      userHasMembership(activeViewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, readableDocument),
    )

    const u1 = { id: "u1", suspended: false } satisfies User
    const u2 = { id: "u2", suspended: true } satisfies User
    const m1 = { id: "m1" } satisfies Membership
    const t1 = { id: "t1" } satisfies Team
    const d1 = { id: "d1", archived: false } satisfies Document
    const d2 = { id: "d2", archived: true } satisfies Document

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: userHasMembership,
          pairs: [
            [u1, m1],
            [u2, m1],
          ],
        },
        { relation: membershipBelongsToTeam, pairs: [[m1, t1]] },
        {
          relation: teamOwnsDocument,
          pairs: [
            [t1, d1],
            [t1, d2],
          ],
        },
      ],
      domain: [u1, u2, m1, t1, d1, d2],
    })

    const instance = evaluator(adapter, {
      evaluatorContext: { db: null },
    })

    const allowed = await instance.evaluate(rule, {
      [viewer]: u1,
      [document]: d1,
      [allowArchivedReads]: false,
    })

    const deniedSuspended = await instance.evaluate(rule, {
      [viewer]: u2,
      [document]: d1,
      [allowArchivedReads]: false,
    })

    const deniedArchived = await instance.evaluate(rule, {
      [viewer]: u1,
      [document]: d2,
      [allowArchivedReads]: false,
    })

    const allowedArchived = await instance.evaluate(rule, {
      [viewer]: u1,
      [document]: d2,
      [allowArchivedReads]: true,
    })

    expect(allowed).toBe(true)
    expect(deniedSuspended).toBe(false)
    expect(deniedArchived).toBe(false)
    expect(allowedArchived).toBe(true)
  })

  it("throws when memo name is blank", () => {
    const value = term<string>()

    expect(() => memo("   ", value)).toThrow("memo name is required")
  })

  it("supports forAll and vacuous truth", async () => {
    const viewer = term<User>()
    const team = term<Team>()
    const membership = term<Membership>()
    const document = term<Document>()

    const userHasMembership = relation<User, Membership>()
    const membershipBelongsToTeam = relation<Membership, Team>()
    const teamOwnsDocument = relation<Team, Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const u2 = { id: "u2", suspended: false } satisfies User
    const m1 = { id: "m1" } satisfies Membership
    const t1 = { id: "t1" } satisfies Team
    const d1 = { id: "d1", archived: false } satisfies Document

    const memberRule = algebra.and(
      membership,
      team,
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, document),
    )

    const rule = forAll(document, memberRule)

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: userHasMembership, pairs: [[u1, m1]] },
        { relation: membershipBelongsToTeam, pairs: [[m1, t1]] },
        { relation: teamOwnsDocument, pairs: [[t1, d1]] },
      ],
      domain: [u1, u2, m1, t1, d1],
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    await expect(
      instance.evaluate(rule, {
        [viewer]: u1,
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [viewer]: u2,
      }),
    ).resolves.toBe(false)

    const emptyDomainAdapter = createInMemoryAdapter({
      relations: [],
      domain: [],
    })

    const emptyDomainInstance = evaluator(emptyDomainAdapter, {
      evaluatorContext: null,
    })

    await expect(
      emptyDomainInstance.evaluate(rule, {
        [viewer]: u1,
      }),
    ).resolves.toBe(true)
  })

  it("handles select, distinct, memo, and eq in execution", async () => {
    const viewer = term<User>()
    const team = term<Team>()
    const membership = term<Membership>()
    const canonicalTeam = term<Team>()

    const userHasMembership = relation<User, Membership>()
    const membershipBelongsToTeam = relation<Membership, Team>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const m1 = { id: "m1" } satisfies Membership
    const t1 = { id: "t1" } satisfies Team

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: userHasMembership,
          pairs: [
            [u1, m1],
            [u1, m1],
          ],
        },
        {
          relation: membershipBelongsToTeam,
          pairs: [
            [m1, t1],
            [m1, t1],
          ],
        },
      ],
      domain: [u1, m1, t1],
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const duplicated = algebra.and(
      membership,
      team,
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      eq(team, canonicalTeam),
      memo("subgraph", select(viewer, team)(team)),
    )

    const rule = distinct(duplicated)

    await expect(
      instance.evaluate(rule, {
        [viewer]: u1,
        [canonicalTeam]: t1,
      }),
    ).resolves.toBe(true)

    const proof = await instance.evaluateWithProof(rule, {
      [viewer]: u1,
      [canonicalTeam]: t1,
    })

    expect(proof.ok).toBe(true)
    expect(proof.details).toEqual(
      expect.objectContaining({
        matchCount: expect.any(Number),
        selectApplied: expect.any(Number),
        distinctApplied: expect.any(Number),
        memoHits: expect.any(Number),
        memoMisses: expect.any(Number),
      }),
    )
    expect(
      (proof.details as { selectApplied: number }).selectApplied,
    ).toBeGreaterThan(0)
    expect(
      (proof.details as { distinctApplied: number }).distinctApplied,
    ).toBeGreaterThan(0)
    expect(
      (proof.details as { memoMisses: number }).memoMisses,
    ).toBeGreaterThan(0)
  })

  it("validates stratified negation", () => {
    const value = term<string>()
    const rule = algebra.not(value)

    expect(() => validateStratifiedNegation(rule)).not.toThrow()

    const recursivePositive = memo("loop", ref("loop"))
    expect(() => validateStratifiedNegation(recursivePositive)).toThrow(
      "recursive rule references are not supported yet",
    )

    const recursiveNegative = memo("neg-loop", algebra.not(ref("neg-loop")))
    expect(() => validateStratifiedNegation(recursiveNegative)).toThrow(
      "non-stratified negation",
    )

    expect(() => validateStratifiedNegation(ref("missing"))).toThrow(
      'unknown ref "missing"',
    )
  })
})

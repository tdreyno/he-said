import {
  atLeast,
  atMost,
  algebra,
  attr,
  createInMemoryAdapter,
  distinct,
  eq,
  exactly,
  exists,
  fact,
  factIsTrue,
  evaluator,
  forAll,
  implies,
  letRule,
  oneOf,
  or,
  isNotNull,
  ref,
  relation,
  select,
  term,
  through,
  type Environment,
  type Rule,
  validateStratifiedNegation,
} from ".."

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

    const activeViewer = viewer.is(v => !v.suspended).is(v => v.id.length > 0)
    const readableDocument = document.is(
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

  it("supports typed relation predicates with rank ordering in the in-memory adapter", async () => {
    const user = term<{ id: string }>()
    const team = term<{ id: string }>()
    const userEditsTeam = relation<{ id: string }, { id: string }>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const u2 = { id: "u2", suspended: false } satisfies User
    const t1 = { id: "t1" } satisfies Team

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: userEditsTeam,
          pairs: [],
          rows: [
            {
              left: u1,
              right: t1,
              columns: { role: "editor", status: "active" },
            },
            {
              left: u2,
              right: t1,
              columns: { role: "viewer", status: "active" },
            },
          ],
          predicates: [
            { column: "status", op: "eq", value: "active" },
            { column: "role", op: "ge", value: "editor" },
          ],
          orderings: [
            {
              column: "role",
              order: { viewer: 10, editor: 20, admin: 30, owner: 40 },
            },
          ],
        },
      ],
      domain: [u1, u2, t1],
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    await expect(
      instance.evaluate(userEditsTeam(user, team), {
        [user]: u1,
        [team]: t1,
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(userEditsTeam(user, team), {
        [user]: u2,
        [team]: t1,
      }),
    ).resolves.toBe(false)
  })

  it("supports colocated relation definitions", async () => {
    const viewer = term<User>()
    const document = term<Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const u2 = { id: "u2", suspended: true } satisfies User
    const d1 = { id: "d1", archived: false } satisfies Document

    const userOwnsDocument = relation<User, Document>([
      [u1, d1],
      [u2, d1],
    ])

    const rule = userOwnsDocument(viewer, document)

    const adapter = createInMemoryAdapter({
      relations: [userOwnsDocument],
      domain: [u1, u2, d1],
    })

    const instance = evaluator(adapter, { evaluatorContext: null })

    await expect(
      instance.evaluate(rule, { [viewer]: u1, [document]: d1 }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, { [viewer]: u2, [document]: d1 }),
    ).resolves.toBe(true)
  })

  it("supports mixing colocated and explicit relation definitions", async () => {
    const viewer = term<User>()
    const team = term<Team>()
    const document = term<Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const t1 = { id: "t1" } satisfies Team
    const d1 = { id: "d1", archived: false } satisfies Document

    const userBelongsToTeam = relation<User, Team>([[u1, t1]])
    const teamOwnsDocument = relation<Team, Document>()

    const rule = algebra.and(
      userBelongsToTeam(viewer, team),
      teamOwnsDocument(team, document),
    )

    const adapter = createInMemoryAdapter({
      relations: [
        userBelongsToTeam,
        { relation: teamOwnsDocument, pairs: [[t1, d1]] },
      ],
      domain: [u1, t1, d1],
    })

    const instance = evaluator(adapter, { evaluatorContext: null })

    await expect(
      instance.evaluate(rule, { [viewer]: u1, [document]: d1 }),
    ).resolves.toBe(true)
  })

  it("supports first-class exists(term) for domain-backed existence checks", async () => {
    const actor = term<User>()
    const document = term<Document>()
    const userCanView = relation<User, Document>()
    const isAdmin = fact<boolean>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const d1 = { id: "d1", archived: false } satisfies Document
    const missing = { id: "d-missing", archived: false } satisfies Document

    const adapter = createInMemoryAdapter({
      relations: [{ relation: userCanView, pairs: [[u1, d1]] }],
      domain: [u1, d1],
    })
    const instance = evaluator(adapter, { evaluatorContext: null })

    const rule = algebra.and(
      factIsTrue(isAdmin),
      exists(document),
      userCanView(actor, document),
    )

    await expect(
      instance.evaluate(rule, {
        [actor]: u1,
        [document]: d1,
        facts: { [isAdmin]: true },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [actor]: u1,
        [document]: missing,
        facts: { [isAdmin]: true },
      }),
    ).resolves.toBe(false)
  })

  it("allows exists(term) to bind from relation-backed candidates without a global domain", async () => {
    const actor = term<User>()
    const document = term<Document>()
    const userCanView = relation<User, Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const d1 = { id: "d1", archived: false } satisfies Document

    const adapter = createInMemoryAdapter({
      relations: [{ relation: userCanView, pairs: [[u1, d1]] }],
      domain: [],
    })
    const instance = evaluator(adapter, { evaluatorContext: null })

    await expect(
      instance.evaluate(
        algebra.and(userCanView(actor, document), exists(document)),
        {
          [actor]: u1,
        },
      ),
    ).resolves.toBe(true)
  })

  it("treats a colocated relation with no pairs as empty", async () => {
    const viewer = term<User>()
    const document = term<Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const d1 = { id: "d1", archived: false } satisfies Document

    const userOwnsDocument = relation<User, Document>()

    const rule = userOwnsDocument(viewer, document)

    const adapter = createInMemoryAdapter({
      relations: [userOwnsDocument],
      domain: [u1, d1],
    })

    const instance = evaluator(adapter, { evaluatorContext: null })

    await expect(
      instance.evaluate(rule, { [viewer]: u1, [document]: d1 }),
    ).resolves.toBe(false)
  })

  it("throws when letRule name is blank", () => {
    const value = term<string>()

    expect(() => letRule("   ", value)).toThrow("letRule name is required")
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

  it("supports logical implication", async () => {
    const a = term<boolean>()
    const b = term<boolean>()
    const adapter = createInMemoryAdapter({
      relations: [],
      domain: [],
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })
    const rule = implies(eq(a, true), eq(b, true))

    await expect(
      instance.evaluate(rule, {
        [a]: false,
        [b]: false,
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [a]: false,
        [b]: true,
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [a]: true,
        [b]: true,
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [a]: true,
        [b]: false,
      }),
    ).resolves.toBe(false)
  })

  it("supports identity-keyed facts bags", async () => {
    const allow = term<boolean>()
    const isAppAdmin = fact<boolean>()
    const adapter = createInMemoryAdapter({
      relations: [],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })
    const rule = algebra.and(
      eq(allow, true),
      or(factIsTrue(isAppAdmin), eq(allow, true)),
    )

    await expect(
      instance.evaluate(rule, {
        [allow]: true,
        facts: {
          [isAppAdmin]: false,
        },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(factIsTrue(isAppAdmin), {
        facts: {
          [isAppAdmin]: true,
        },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(factIsTrue(isAppAdmin), {
        facts: {
          [isAppAdmin]: false,
        },
      }),
    ).resolves.toBe(false)
  })

  it("supports oneOf membership checks", async () => {
    const action = term<string>()
    const adapter = createInMemoryAdapter({
      relations: [],
      domain: [],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const canReadLike = oneOf(action, ["read", "export"])

    await expect(
      instance.evaluate(canReadLike, {
        [action]: "read",
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(canReadLike, {
        [action]: "export",
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(canReadLike, {
        [action]: "delete",
      }),
    ).resolves.toBe(false)

    const emptyMembership = oneOf(action, [])
    await expect(
      instance.evaluate(emptyMembership, {
        [action]: "read",
      }),
    ).resolves.toBe(false)
  })

  it("filters candidate subsets with in-memory adapter", async () => {
    const viewer = term<User>()
    const document = term<Document>()
    const userOwnsDocument = relation<User, Document>()

    const u1 = { id: "u1", suspended: false } satisfies User
    const d1 = { id: "d1", archived: false } satisfies Document
    const d2 = { id: "d2", archived: false } satisfies Document

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: userOwnsDocument,
          pairs: [[u1, d1]],
        },
      ],
      domain: [u1, d1, d2],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const allowed = await instance.filter(userOwnsDocument(viewer, document), {
      environment: { [viewer]: u1 },
      term: document,
      candidates: [d1, d2],
    })

    expect(allowed).toEqual([d1])
  })

  it("supports cardinality helpers", async () => {
    const a = term<boolean>()
    const b = term<boolean>()
    const c = term<boolean>()
    const adapter = createInMemoryAdapter({
      relations: [],
      domain: [],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const aTrue = eq(a, true)
    const bTrue = eq(b, true)
    const cTrue = eq(c, true)

    const atLeastTwo = atLeast(2, aTrue, bTrue, cTrue)
    const atMostOne = atMost(1, aTrue, bTrue, cTrue)
    const exactlyTwo = exactly(2, aTrue, bTrue, cTrue)

    await expect(
      instance.evaluate(atLeastTwo, {
        [a]: true,
        [b]: true,
        [c]: false,
      }),
    ).resolves.toBe(true)
    await expect(
      instance.evaluate(atLeastTwo, {
        [a]: true,
        [b]: false,
        [c]: false,
      }),
    ).resolves.toBe(false)

    await expect(
      instance.evaluate(atMostOne, {
        [a]: true,
        [b]: false,
        [c]: false,
      }),
    ).resolves.toBe(true)
    await expect(
      instance.evaluate(atMostOne, {
        [a]: true,
        [b]: true,
        [c]: false,
      }),
    ).resolves.toBe(false)

    await expect(
      instance.evaluate(exactlyTwo, {
        [a]: true,
        [b]: true,
        [c]: false,
      }),
    ).resolves.toBe(true)
    await expect(
      instance.evaluate(exactlyTwo, {
        [a]: true,
        [b]: true,
        [c]: true,
      }),
    ).resolves.toBe(false)
  })

  it("validates cardinality helper count inputs", () => {
    const value = term<boolean>()

    expect(() => atLeast(-1, value)).toThrow(
      "atLeast requires a non-negative integer count",
    )
    expect(() => atMost(1.5, value)).toThrow(
      "atMost requires a non-negative integer count",
    )
    expect(() => exactly(NaN, value)).toThrow(
      "exactly requires a non-negative integer count",
    )
  })

  it("handles select, distinct, letRule, and eq in execution", async () => {
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
      letRule("subgraph", select(viewer, team)(team)),
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

  it("returns a structured failing node when evaluation is denied", async () => {
    const viewer = term<User>()
    const role = term<string>()
    const hasRole = relation<User, string>()

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: hasRole,
          pairs: [],
        },
      ],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const proof = await instance.evaluateWithProof(
      algebra.and(hasRole(viewer, role), eq(role, "owner")),
      {
        [viewer]: { id: "u1", suspended: false },
      },
    )

    expect(proof.ok).toBe(false)
    expect(proof.failing).toEqual(
      expect.objectContaining({
        kind: "relation",
        path: "root.and[0]",
        reason: "no matching relation facts",
      }),
    )
  })

  it("supports fluent through builder", async () => {
    type AclEntry = { id: string }
    type User = { id: string }
    type Document = { id: string }
    type Permission = "read" | "write"

    const aclEntry = term<AclEntry>()
    const user = term<User>()
    const document = term<Document>()
    const permission = term<Permission>()

    const aclEntryUser = relation<AclEntry, User>()
    const aclEntryDocument = relation<AclEntry, Document>()
    const aclEntryPermission = relation<AclEntry, Permission>()

    const canRead = permission.is(p => p === "read" || p === "write")

    const e1 = { id: "acl-1" } satisfies AclEntry
    const u1 = { id: "user-1" } satisfies User
    const d1 = { id: "doc-1" } satisfies Document
    const perm1 = "read" satisfies Permission

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: aclEntryUser, pairs: [[e1, u1]] },
        { relation: aclEntryDocument, pairs: [[e1, d1]] },
        { relation: aclEntryPermission, pairs: [[e1, perm1]] },
      ],
      domain: [e1, u1, d1],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = through(aclEntry)
      .to(aclEntryUser, user)
      .to(aclEntryDocument, document)
      .to(aclEntryPermission, canRead)

    expect(rule.type).toBe("and")
    expect((rule as { children: unknown[] }).children.length).toBe(3)

    await expect(
      instance.evaluate(rule, {
        [aclEntry]: e1,
        [user]: u1,
        [document]: d1,
        [permission]: perm1,
      }),
    ).resolves.toBe(true)
  })

  it("validates stratified negation", () => {
    const value = term<string>()
    const rule = algebra.not(value)

    expect(() => validateStratifiedNegation(rule)).not.toThrow()

    const recursivePositive = letRule("loop", ref("loop"))
    expect(() => validateStratifiedNegation(recursivePositive)).toThrow(
      "recursive rule references are not supported yet",
    )

    const recursiveNegative = letRule("neg-loop", algebra.not(ref("neg-loop")))
    expect(() => validateStratifiedNegation(recursiveNegative)).toThrow(
      "non-stratified negation",
    )

    expect(() => validateStratifiedNegation(ref("missing"))).toThrow(
      'unknown ref "missing"',
    )
  })

  it("supports derives() for transitive entity relationships", async () => {
    const entity = term<string>()
    const adapter = createInMemoryAdapter({
      relations: [],
      domain: ["a", "b", "c"],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    // Test basic derives with two different entities
    const rule = algebra.derives(entity, entity)
    await expect(
      instance.evaluate(rule, {
        [entity]: "a",
      }),
    ).resolves.toBe(true)

    // Test derives with bound entity - should succeed when values match
    const e1 = term<string>()
    const e2 = term<string>()
    const derivesRule = algebra.derives(e1, e2)

    await expect(
      instance.evaluate(derivesRule, {
        [e1]: "test",
        [e2]: "test",
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(derivesRule, {
        [e1]: "test",
        [e2]: "other",
      }),
    ).resolves.toBe(false)
  })

  it("supports given() for contextual rule scoping", async () => {
    const user = term<User>()
    const isModerator = term<boolean>()

    const adapter = createInMemoryAdapter({
      relations: [],
      domain: [
        { id: "u1", suspended: false },
        { id: "u2", suspended: true },
      ],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const activeUser = user.is(u => !u.suspended)
    const canRead = eq(isModerator, true)

    // Rule that requires both context (active user) and permission
    const rule = algebra.given(canRead, activeUser)

    const moderatorActive = await instance.evaluate(rule, {
      [user]: { id: "u1", suspended: false },
      [isModerator]: true,
    })
    expect(moderatorActive).toBe(true)

    const moderatorSuspended = await instance.evaluate(rule, {
      [user]: { id: "u2", suspended: true },
      [isModerator]: true,
    })
    expect(moderatorSuspended).toBe(false)

    const nonModeratorActive = await instance.evaluate(rule, {
      [user]: { id: "u1", suspended: false },
      [isModerator]: false,
    })
    expect(nonModeratorActive).toBe(false)
  })

  it("supports derives() with relations for role hierarchies", async () => {
    const role = term<string>()
    const derivedFrom = relation<string, string>()

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: derivedFrom,
          pairs: [
            ["admin", "moderator"],
            ["moderator", "viewer"],
          ],
        },
      ],
      domain: ["admin", "moderator", "viewer"],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    // Admin derives from moderator relation
    const adminRule = algebra.and(
      role,
      derivedFrom(
        role,
        term<string>().is(v => v === "moderator"),
      ),
    )

    await expect(
      instance.evaluate(adminRule, {
        [role]: "admin",
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(adminRule, {
        [role]: "viewer",
      }),
    ).resolves.toBe(false)
  })

  it("combines derives() and given() for complex authorization", async () => {
    const user = term<User>()
    const role = term<string>()
    const permission = term<string>()
    const roleDerivation = relation<string, string>()

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: roleDerivation,
          pairs: [
            ["admin", "editor"],
            ["editor", "viewer"],
          ],
        },
      ],
      domain: [
        { id: "u1", suspended: false },
        { id: "u2", suspended: true },
      ],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const activeUser = user.is(u => !u.suspended)
    const hasPermission = eq(permission, "read")
    const isInRole = algebra.and(
      role,
      roleDerivation(
        role,
        term<string>().is(v => v === "editor"),
      ),
    )

    // Complex rule: user must be active AND have the permission AND be in an admin/editor role
    const complexRule = algebra.given(
      algebra.and(hasPermission, isInRole),
      activeUser,
    )

    await expect(
      instance.evaluate(complexRule, {
        [user]: { id: "u1", suspended: false },
        [permission]: "read",
        [role]: "admin",
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(complexRule, {
        [user]: { id: "u2", suspended: true },
        [permission]: "read",
        [role]: "admin",
      }),
    ).resolves.toBe(false)

    await expect(
      instance.evaluate(complexRule, {
        [user]: { id: "u1", suspended: false },
        [permission]: "write",
        [role]: "admin",
      }),
    ).resolves.toBe(false)
  })

  it("evaluates expression predicates attached through term.is(...)", async () => {
    type Viewer = { id: string; suspended: boolean }
    type RecordDoc = {
      id: string
      ownerId: string
      workspaceAccess: string | null
    }

    const viewer = term<Viewer>()
    const document = term<RecordDoc>()

    const rule = algebra.and(
      viewer.is(eq(attr(viewer, "id"), attr(document, "ownerId"))),
      document.is(isNotNull(attr(document, "workspaceAccess"))),
    )

    const adapter = createInMemoryAdapter({
      relations: [],
      domain: [
        { id: "u1", suspended: false } satisfies Viewer,
        {
          id: "d1",
          ownerId: "u1",
          workspaceAccess: "read",
        } satisfies RecordDoc,
      ],
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    await expect(
      instance.evaluate(rule, {
        [viewer]: { id: "u1", suspended: false },
        [document]: { id: "d1", ownerId: "u1", workspaceAccess: "read" },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [viewer]: { id: "u1", suspended: false },
        [document]: { id: "d1", ownerId: "u2", workspaceAccess: "read" },
      }),
    ).resolves.toBe(false)
  })

  it("supports prepared evaluators with adapter fallback merging", async () => {
    type Viewer = { id: string }
    type Document = { id: string }

    const viewer = term<Viewer>()
    const document = term<Document>()
    const userOwnsDocument = relation<Viewer, Document>()
    const rule = userOwnsDocument(viewer, document)

    const capturedEnvironments: Array<Environment> = []
    const adapter = {
      evaluate: async (_rule: Rule, environment: Readonly<Environment>) => {
        capturedEnvironments.push(environment)
        return true
      },
    }
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const prepared = await instance.prepare({
      environment: {
        [viewer]: { id: "u1" },
      },
    })

    await prepared.evaluate(rule, {
      [document]: { id: "d1" },
    })
    await prepared.evaluate(rule, {
      [document]: { id: "d2" },
    })

    expect(capturedEnvironments).toHaveLength(2)
    expect(capturedEnvironments[0]?.[viewer]).toEqual({ id: "u1" })
    expect(capturedEnvironments[1]?.[viewer]).toEqual({ id: "u1" })
    expect(capturedEnvironments[0]?.[document]).toEqual({ id: "d1" })
    expect(capturedEnvironments[1]?.[document]).toEqual({ id: "d2" })
  })
})

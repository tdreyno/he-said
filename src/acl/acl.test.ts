import {
  action,
  actionIs,
  allow,
  deny,
  enforcer,
  eq,
  failure,
  policy,
} from "./index"

type User = {
  id: string
  suspended: boolean
  team: string
}

type Document = {
  id: string
  ownerId: string
  team: string
}

describe("acl", () => {
  it("uses deny precedence over allow", async () => {
    const READ = action("read")
    const SUSPENDED = failure("Suspended users are blocked.")

    const denySuspended = deny(
      eq((subject: User) => subject.suspended, true),
      {
        failure: SUSPENDED,
        priority: 100,
      },
    )

    const allowRead = allow(actionIs(READ), {
      priority: 10,
    })

    const authz = enforcer(policy(allowRead, denySuspended))

    const result = await authz.can(READ, {
      subject: {
        id: "u1",
        suspended: true,
        team: "eng",
      },
      resource: {
        id: "d1",
        ownerId: "u1",
        team: "eng",
      },
      environment: {
        isBusinessHours: true,
      },
    })

    expect(result.allowed).toBe(false)
    expect(result.failureToken).toBe(SUSPENDED)
    expect(result.reason).toBe("Suspended users are blocked.")
    expect(result.trace.matchedRules).toHaveLength(1)
    expect(result.trace.matchedRules[0]?.kind).toBe("deny")
  })

  it("treats Rule[] in allow/deny as and(...)", async () => {
    const READ = action("read")

    const allowOwnerRead = allow([
      actionIs(READ),
      eq(
        (subject: User) => subject.id,
        (resource: Document) => resource.ownerId,
      ),
    ])

    const authz = enforcer(policy(allowOwnerRead))

    const ownerResult = await authz.can(READ, {
      subject: {
        id: "u1",
        suspended: false,
        team: "eng",
      },
      resource: {
        id: "d1",
        ownerId: "u1",
        team: "eng",
      },
      environment: {
        isBusinessHours: true,
      },
    })

    expect(ownerResult.allowed).toBe(true)
  })

  it("defaults to deny when no allow rule matches", async () => {
    const READ = action("read")

    const authz = enforcer(policy())

    const result = await authz.can(READ, {
      subject: {
        id: "u2",
        suspended: false,
        team: "finance",
      },
      resource: {
        id: "d2",
        ownerId: "u1",
        team: "eng",
      },
      environment: {
        isBusinessHours: true,
      },
    })

    expect(result.allowed).toBe(false)
    expect(result.trace.checkedRules).toHaveLength(0)
  })
})

import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  eqEnv,
  failure,
  ge,
  policy,
} from "./index"

type User = {
  id: string
  department: string
  clearance: number
  suspended: boolean
}

type Resource = {
  ownerId: string
  department: string
  sensitivity: number
}

describe("abac", () => {
  it("denies suspended users with failure token", async () => {
    const READ = action("read")
    const SUSPENDED = failure("Suspended users cannot access documents.")

    const denySuspended = deny(
      eq((u: User) => u.suspended, true),
      {
        failure: SUSPENDED,
      },
    )

    const allowRead = approve(actionIs(READ))

    const authz = enforcer(policy(denySuspended, allowRead))

    const result = await authz.can(READ, {
      user: {
        id: "u1",
        department: "eng",
        clearance: 10,
        suspended: true,
      },
      resource: {
        ownerId: "u2",
        department: "eng",
        sensitivity: 2,
      },
      environment: {
        isBusinessHours: true,
      },
    })

    expect(result.allowed).toBe(false)
    expect(result.failureToken).toBe(SUSPENDED)
    expect(result.reason).toBe("Suspended users cannot access documents.")
    expect(result.trace.matchedRules).toHaveLength(1)
    expect(result.trace.matchedRules[0]?.kind).toBe("deny")
  })

  it("treats Rule[] in approve/deny as and(...)", async () => {
    const READ = action("read")
    const denyAfterHours = deny(
      [
        actionIs(READ),
        eqEnv(
          (environment: { isBusinessHours: boolean }) =>
            environment.isBusinessHours,
          false,
        ),
      ],
      { name: "after-hours" },
    )

    const approveRead = approve([
      actionIs(READ),
      eq(
        (user: User) => user.department,
        (resource: Resource) => resource.department,
      ),
      ge(
        (user: User) => user.clearance,
        (resource: Resource) => resource.sensitivity,
      ),
    ])

    const authz = enforcer(policy(denyAfterHours, approveRead))

    const denied = await authz.can(READ, {
      user: {
        id: "u1",
        department: "eng",
        clearance: 10,
        suspended: false,
      },
      resource: {
        ownerId: "u2",
        department: "eng",
        sensitivity: 2,
      },
      environment: {
        isBusinessHours: false,
      },
    })

    expect(denied.allowed).toBe(false)

    const allowed = await authz.can(READ, {
      user: {
        id: "u1",
        department: "eng",
        clearance: 10,
        suspended: false,
      },
      resource: {
        ownerId: "u2",
        department: "eng",
        sensitivity: 2,
      },
      environment: {
        isBusinessHours: true,
      },
    })

    expect(allowed.allowed).toBe(true)
  })
})

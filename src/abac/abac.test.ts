import {
  attr,
  createInMemoryAdapter,
  createPostgresAdapter,
  eq as coreEq,
  ge as coreGe,
  relation,
  type PostgresQueryExecutor,
} from ".."
import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq as abacEq,
  eqEnv,
  failure,
  ge as abacGe,
  policy,
  resourceTerm,
  userTerm,
} from "./index"

type User = {
  id: string
  department: string
  clearance: number
  suspended: boolean
}

type Resource = {
  id: string
  ownerId: string
  department: string
  sensitivity: number
}

describe("abac", () => {
  it("denies suspended users with failure token", async () => {
    const READ = action("read")
    const SUSPENDED = failure("Suspended users cannot access documents.")

    const denySuspended = deny(
      abacEq((u: User) => u.suspended, true),
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
        id: "d1",
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
      abacEq(
        (user: User) => user.department,
        (resource: Resource) => resource.department,
      ),
      abacGe(
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
        id: "d1",
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
        id: "d1",
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

  it("supports expression and relation inputs in approve/deny", async () => {
    const READ = action("read")
    const SUSPENDED = failure("Suspended users cannot access documents.")
    const userInDocumentWorkspace = relation<User, Resource>()

    const denySuspended = deny(
      coreEq(attr(userTerm<User>(), "suspended"), true),
      {
        failure: SUSPENDED,
      },
    )

    const approveRead = approve([
      userInDocumentWorkspace(userTerm<User>(), resourceTerm<Resource>()),
      coreEq(
        attr(userTerm<User>(), "department"),
        attr(resourceTerm<Resource>(), "department"),
      ),
      coreGe(
        attr(userTerm<User>(), "clearance"),
        attr(resourceTerm<Resource>(), "sensitivity"),
      ),
    ])

    const departmentUser: User = {
      id: "u1",
      department: "eng",
      clearance: 10,
      suspended: false,
    }
    const document: Resource = {
      id: "d1",
      ownerId: "u2",
      department: "eng",
      sensitivity: 2,
    }

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: userInDocumentWorkspace,
          pairs: [[departmentUser, document]],
        },
      ],
      domain: [departmentUser, document],
    })

    const authz = enforcer(policy(denySuspended, approveRead), {
      adapter,
      evaluatorContext: undefined,
    })

    const allowed = await authz.can(READ, {
      user: departmentUser,
      resource: document,
      environment: {
        isBusinessHours: true,
      },
    })

    expect(allowed.allowed).toBe(true)

    const denied = await authz.can(READ, {
      user: {
        ...departmentUser,
        suspended: true,
      },
      resource: document,
      environment: {
        isBusinessHours: true,
      },
    })

    expect(denied.allowed).toBe(false)
    expect(denied.failureToken).toBe(SUSPENDED)
  })

  it("evaluates deny-first precedence with a postgres adapter", async () => {
    const READ = action("read")
    const SUSPENDED = failure("Suspended users cannot access documents.")
    const userInDocumentWorkspace = relation<User, Resource>()

    const denySuspended = deny(
      coreEq(attr(userTerm<User>(), "suspended"), true),
      {
        failure: SUSPENDED,
        name: "deny-suspended",
      },
    )

    const approveRead = approve(
      [
        userInDocumentWorkspace(userTerm<User>(), resourceTerm<Resource>()),
        coreEq(
          attr(userTerm<User>(), "department"),
          attr(resourceTerm<Resource>(), "department"),
        ),
      ],
      { name: "approve-read" },
    )

    const query = jest.fn(
      async (sql: string, params: ReadonlyArray<unknown>) => {
        if (sql.includes('"users"') && sql.includes('"suspended"')) {
          return { rows: [{ ok: params[0] === "u-suspended" }] }
        }

        if (sql.includes('"workspace_memberships"')) {
          return { rows: [{ ok: params[0] === "u-active" }] }
        }

        return { rows: [{ ok: false }] }
      },
    )
    const queryExecutor: PostgresQueryExecutor = {
      query: query as unknown as PostgresQueryExecutor["query"],
    }

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInDocumentWorkspace,
          source: {
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "document_id",
          },
        },
      ],
      termDomains: [
        {
          term: userTerm<User>(),
          table: "users",
          valueColumn: "id",
          columns: {
            suspended: "suspended",
            department: "department",
            clearance: "clearance",
          },
        },
        {
          term: resourceTerm<Resource>(),
          table: "documents",
          valueColumn: "id",
          columns: {
            department: "department",
            sensitivity: "sensitivity",
          },
        },
      ],
      termEncodings: [
        {
          term: userTerm<User>(),
          encode: value => value.id,
        },
        {
          term: resourceTerm<Resource>(),
          encode: value => value.id,
        },
      ],
      queryExecutor,
      includeFailingNodeSql: true,
    })

    const authz = enforcer(policy(denySuspended, approveRead), {
      adapter,
      evaluatorContext: null,
    })

    const denied = await authz.can(READ, {
      user: {
        id: "u-suspended",
        department: "eng",
        clearance: 1,
        suspended: true,
      },
      resource: {
        id: "d1",
        ownerId: "d1",
        department: "eng",
        sensitivity: 1,
      },
      environment: {},
    })

    expect(denied.allowed).toBe(false)
    expect(denied.failureToken).toBe(SUSPENDED)
    expect(denied.trace.checkedRules).toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
    const callsAfterDenied = query.mock.calls.length

    const allowed = await authz.can(READ, {
      user: {
        id: "u-active",
        department: "eng",
        clearance: 3,
        suspended: false,
      },
      resource: {
        id: "d2",
        ownerId: "d2",
        department: "eng",
        sensitivity: 2,
      },
      environment: {},
    })

    expect(allowed.allowed).toBe(true)
    expect(allowed.trace.checkedRules).toHaveLength(2)
    expect(allowed.trace.checkedRules.map(rule => rule.kind)).toEqual([
      "deny",
      "approve",
    ])
    expect(allowed.trace.checkedRules[0]?.proof?.failing).toBeDefined()
    expect(query.mock.calls.length).toBeGreaterThan(callsAfterDenied)
  })
})

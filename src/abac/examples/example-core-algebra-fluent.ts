/**
 * ABAC example with heavy core-algebra composition.
 *
 * This keeps ABAC domain helpers (actionIs, eq, ge, eqEnv)
 * while using core combinators for rich policy composition.
 */

import { and, atLeast, not, or } from "../../core/algebra"
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
} from "../index"

type User = {
  id: string
  department: string
  clearance: number
  suspended: boolean
}

type Document = {
  id: string
  ownerId: string
  department: string
  sensitivity: number
  archived: boolean
}

type Environment = {
  isBusinessHours: boolean
}

async function run(): Promise<void> {
  const READ = action("read")

  const sameDepartment = eq(
    (user: User) => user.department,
    (resource: Document) => resource.department,
  )

  const isOwner = eq(
    (user: User) => user.id,
    (resource: Document) => resource.ownerId,
  )

  const sufficientClearance = ge(
    (user: User) => user.clearance,
    (resource: Document) => resource.sensitivity,
  )

  const duringBusinessHours = eqEnv(
    (environment: Environment) => environment.isBusinessHours,
    true,
  )

  const denySuspended = deny(
    and(
      actionIs(READ),
      eq((user: User) => user.suspended, true),
    ),
    {
      name: "deny-suspended",
      failure: failure("Suspended users cannot access documents."),
      priority: 100,
    },
  )

  const denyArchived = deny(
    and(
      actionIs(READ),
      eq((resource: Document) => resource.archived, true),
    ),
    {
      name: "deny-archived",
      failure: failure(
        "Archived documents are read-only through admin channels.",
      ),
      priority: 90,
    },
  )

  const approveRead = approve(
    and(
      actionIs(READ),
      not(eq((resource: Document) => resource.archived, true)),
      duringBusinessHours,
      or(
        isOwner,
        and(sameDepartment, sufficientClearance),
        atLeast(2, sameDepartment, isOwner, sufficientClearance),
      ),
    ),
    {
      name: "approve-read-composed",
      priority: 10,
    },
  )

  const authz = enforcer(policy(denySuspended, denyArchived, approveRead))

  const decision = await authz.can(READ, {
    user: {
      id: "u1",
      department: "engineering",
      clearance: 4,
      suspended: false,
    },
    resource: {
      id: "d1",
      ownerId: "u2",
      department: "engineering",
      sensitivity: 2,
      archived: false,
    },
    environment: {
      isBusinessHours: true,
    },
  })

  console.log("allowed:", decision.allowed)
  console.log("reason:", decision.reason)
}

void run()

/**
 * ACL multi-tenant style example.
 */

import {
  action,
  actionIs,
  allow,
  deny,
  enforcer,
  eq,
  failure,
  policy,
} from "../index"

type User = {
  id: string
  tenantId: string
  suspended: boolean
}

type Document = {
  id: string
  tenantId: string
  ownerId: string
}

async function run(): Promise<void> {
  const READ = action("read")

  const denySuspended = deny(
    eq((subject: User) => subject.suspended, true),
    {
      failure: failure("Suspended accounts are blocked."),
      priority: 100,
    },
  )

  const allowTenantOwnerRead = allow([
    actionIs(READ),
    eq(
      (subject: User) => subject.tenantId,
      (resource: Document) => resource.tenantId,
    ),
    eq(
      (subject: User) => subject.id,
      (resource: Document) => resource.ownerId,
    ),
  ])

  const authz = enforcer(policy(denySuspended, allowTenantOwnerRead))

  const decision = await authz.can(READ, {
    subject: {
      id: "u1",
      tenantId: "t1",
      suspended: false,
    },
    resource: {
      id: "d1",
      tenantId: "t1",
      ownerId: "u1",
    },
  })

  console.log("allowed:", decision.allowed)
}

void run()

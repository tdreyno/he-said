/**
 * Basic ACL example
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
  suspended: boolean
}

type Document = {
  id: string
  ownerId: string
}

async function run(): Promise<void> {
  const READ = action("read")

  const denySuspended = deny(
    eq((subject: User) => subject.suspended, true),
    {
      failure: failure("Suspended users cannot access documents."),
      priority: 100,
    },
  )

  const allowOwnerRead = allow([
    actionIs(READ),
    eq(
      (subject: User) => subject.id,
      (resource: Document) => resource.ownerId,
    ),
  ])

  const authz = enforcer(policy(denySuspended, allowOwnerRead))

  const decision = await authz.can(READ, {
    subject: {
      id: "u1",
      suspended: false,
    },
    resource: {
      id: "d1",
      ownerId: "u1",
    },
  })

  console.log("allowed:", decision.allowed)
}

void run()

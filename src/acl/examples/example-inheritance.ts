/**
 * ACL inheritance-style example with action families.
 */

import {
  action,
  actionIn,
  allow,
  deny,
  enforcer,
  eq,
  failure,
  policy,
} from "../index"

type User = {
  id: string
  team: string
  clearance: number
}

type RecordDoc = {
  id: string
  ownerId: string
  team: string
  sensitivity: number
}

async function run(): Promise<void> {
  const READ = action("read")
  const UPDATE = action("update")
  const DELETE = action("delete")

  const denyDeleteCrossTeam = deny(
    [
      actionIn(DELETE),
      eq(
        (subject: User) => subject.team,
        (resource: RecordDoc) => resource.team,
      ),
    ],
    {
      name: "deny-delete-cross-team",
      failure: failure("Delete is denied outside your team."),
      priority: 100,
    },
  )

  const allowOwnerOrTeam = allow([
    actionIn(READ, UPDATE),
    eq(
      (subject: User) => subject.id,
      (resource: RecordDoc) => resource.ownerId,
    ),
  ])

  const authz = enforcer(policy(denyDeleteCrossTeam, allowOwnerOrTeam))

  const decision = await authz.can(UPDATE, {
    subject: {
      id: "u-manager",
      team: "finance",
      clearance: 4,
    },
    resource: {
      id: "r1",
      ownerId: "u-manager",
      team: "finance",
      sensitivity: 2,
    },
  })

  console.log("allowed:", decision.allowed)
}

void run()

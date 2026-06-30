import { action, actionIs, allow, deny, eq, policy } from "./index"

type Subject = {
  id: string
  team: string
  suspended: boolean
}

type Resource = {
  ownerId: string
  team: string
}

const READ = action("read")

const denySuspended = deny(eq((subject: Subject) => subject.suspended, true))

const allowOwner = allow([
  actionIs(READ),
  eq(
    (subject: Subject) => subject.id,
    (resource: Resource) => resource.ownerId,
  ),
])

policy(denySuspended, allowOwner)

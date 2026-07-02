import { attr, createInMemoryAdapter, eq as coreEq, relation } from "../index"
import {
  action,
  actionIs,
  approve,
  deny,
  enforcer,
  eq,
  ge,
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
  ownerId: string
  department: string
  sensitivity: number
}

const READ = action("read")

const denySuspended = deny(eq((user: User) => user.suspended, true))

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

const belongsToWorkspace = relation<User, Resource>()
const denySuspendedExpr = deny(
  coreEq(attr(userTerm<User>(), "suspended"), true),
)
const approveReadExpr = approve([
  belongsToWorkspace(userTerm<User>(), resourceTerm<Resource>()),
  coreEq(
    attr(userTerm<User>(), "department"),
    attr(resourceTerm<Resource>(), "department"),
  ),
])

const adapter = createInMemoryAdapter({
  relations: [],
})

enforcer(policy(denySuspendedExpr, approveReadExpr), {
  adapter,
  evaluatorContext: undefined,
})

policy(denySuspended, approveRead)

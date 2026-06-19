import { RelationTuple } from "./types"

export const relationTuple = (
  subject: string,
  relation: string,
  object: string,
): RelationTuple => ({
  subject,
  relation,
  object,
})

export const owner = (subject: string, object: string): RelationTuple =>
  relationTuple(subject, "owner", object)

export const member = (subject: string, object: string): RelationTuple =>
  relationTuple(subject, "member", object)

export const parent = (subject: string, object: string): RelationTuple =>
  relationTuple(subject, "parent", object)

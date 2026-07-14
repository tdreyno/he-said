import { term, type Term } from "../core/algebra"
import { relation } from "../core/algebra"
import { through } from "./rebac-builder"
import { resourceType } from "./resource-type"

describe("resourceType.bindRef", () => {
  const inTeam = relation<{ id: string }, string>()

  it("binds the resource term to ref.id for context-free types", () => {
    const project = resourceType<{ id: string }, string>({
      table: "projects",
      owner: through(inTeam),
    })

    const env = project.bindRef({ id: "project-1" })

    expect(env).not.toBeNull()
    expect(env![project.term as unknown as symbol]).toBe("project-1")
  })

  it("binds declared context terms from ref.context", () => {
    const branchT = term<string>("branch")
    const node = resourceType<
      { id: string },
      string,
      { branchId: Term<string> }
    >({
      table: "canvas_nodes",
      context: { branchId: branchT },
      owner: through(inTeam),
    })

    const env = node.bindRef({
      id: "node-1",
      context: { branchId: "branch-1" },
    })

    expect(env).not.toBeNull()
    expect(env![node.term as unknown as symbol]).toBe("node-1")
    expect(env![branchT as unknown as symbol]).toBe("branch-1")
  })

  it("returns null (fail-closed) when a declared context value is missing", () => {
    const branchT = term<string>("branch")
    const node = resourceType<
      { id: string },
      string,
      { branchId: Term<string> }
    >({
      table: "canvas_nodes",
      context: { branchId: branchT },
      owner: through(inTeam),
    })

    expect(node.bindRef({ id: "node-1" })).toBeNull()
    expect(node.bindRef({ id: "node-1", context: {} })).toBeNull()
    expect(
      node.bindRef({ id: "node-1", context: { branchId: undefined } }),
    ).toBeNull()
  })

  it("does not disturb the existing row-shaped bind()", () => {
    const project = resourceType<{ id: string }, string>({
      table: "projects",
      owner: through(inTeam),
    })

    const env = project.bind({ id: "project-1" })

    expect(env[project.term as unknown as symbol]).toEqual({ id: "project-1" })
  })
})

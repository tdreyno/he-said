import {
  createInMemoryAdapter,
  evaluator,
  relation,
  term,
  type InMemoryRelationFacts,
  type Rule,
} from ".."
import { either, grant, roleTiers, scopedPolicy, through } from "./index"

type User = string
type Team = string
type Workspace = string
type Project = string
type File = string

describe("rebac facade", () => {
  it("compiles ownership + tiered grants and emits source predicates", async () => {
    const actor = term<User>()
    const scope = term<Team>()

    const fileInProject = relation<File, Project>()
    const projectInTeam = relation<Project, Team>()
    const fileInTeam = relation<File, Team>()
    const memberOfTeam = relation<User, Team>()

    const tiers = roleTiers("viewer", "editor", "owner")
    const policy = scopedPolicy<
      User,
      Team,
      { File: File },
      "update",
      "viewer" | "editor" | "owner"
    >({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers,
      },
      resources: {
        File: either(
          through(fileInTeam),
          through(fileInProject, projectInTeam),
        ),
      },
      grants: {
        update: grant.atLeast("editor"),
      },
    })

    expect(tiers.atLeast("editor")).toEqual(["editor", "owner"])
    expect(policy.roleRequirementFor("update", "File")).toEqual({
      minimum: "editor",
      predicate: { column: "role", op: "ge", value: "editor" },
      ordering: {
        column: "role",
        order: { viewer: 1, editor: 2, owner: 3 },
      },
    })

    const memberFactsInput: InMemoryRelationFacts<User, Team> = {
      relation: memberOfTeam,
      rows: [
        {
          left: "alice",
          right: "team-1",
          columns: { role: "editor" },
        },
        {
          left: "bob",
          right: "team-1",
          columns: { role: "viewer" },
        },
      ],
      pairs: [["alice", "team-1"] as const, ["bob", "team-1"] as const],
    }
    const memberFacts = policy.sourceFor("update", "File", memberFactsInput)

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: fileInTeam,
          pairs: [["file-1", "team-1"]],
        },
        {
          relation: fileInProject,
          pairs: [["file-1", "project-1"]],
        },
        {
          relation: projectInTeam,
          pairs: [["project-1", "team-1"]],
        },
        memberFacts,
      ],
      domain: ["alice", "bob", "team-1", "file-1"],
    })

    const runtime = evaluator(adapter, { evaluatorContext: null })
    const rule = policy.ruleFor("update", "File")
    const resourceTerm = policy.resourceTerms.File

    await expect(
      runtime.evaluate(rule, {
        [actor]: "alice",
        [resourceTerm]: "file-1",
      }),
    ).resolves.toBe(true)

    await expect(
      runtime.evaluate(rule, {
        [actor]: "bob",
        [resourceTerm]: "file-1",
      }),
    ).resolves.toBe(false)
  })

  it("supports read-scope widening with grant.readScope()", async () => {
    const actor = term<User>()
    const team = term<Team>()

    const fileInTeam = relation<File, Team>()
    const teamInWorkspace = relation<Team, Workspace>()
    const memberOfTeam = relation<User, Team>()
    const memberOfWorkspace = relation<User, Workspace>()

    const policy = scopedPolicy<
      User,
      Team,
      { File: File },
      "read",
      "viewer" | "editor",
      Workspace
    >({
      actor,
      scope: team,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      readScope: {
        via: through(teamInWorkspace),
        membership: memberOfWorkspace,
      },
      resources: {
        File: through(fileInTeam),
      },
      grants: {
        read: grant.readScope(),
      },
    })

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: fileInTeam,
          pairs: [["file-1", "team-1"]],
        },
        {
          relation: teamInWorkspace,
          pairs: [["team-1", "workspace-1"]],
        },
        {
          relation: memberOfWorkspace,
          pairs: [["alice", "workspace-1"]],
        },
      ],
      domain: ["file-1", "team-1", "workspace-1"],
    })

    const runtime = evaluator(adapter, { evaluatorContext: null })

    await expect(
      runtime.evaluate(policy.ruleFor("read", "File"), {
        [actor]: "alice",
        [policy.resourceTerms.File]: "file-1",
      }),
    ).resolves.toBe(true)
  })

  it("supports override grants as arbitrary core rules", async () => {
    const actor = term<User>()
    const team = term<Team>()
    const fileInTeam = relation<File, Team>()
    const authoredBy = relation<File, User>()

    const policy = scopedPolicy<
      User,
      Team,
      { File: File },
      "read",
      "viewer" | "editor"
    >({
      actor,
      scope: team,
      membership: {
        relation: relation<User, Team>(),
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: {
        File: through(fileInTeam),
      },
      grants: {
        read: grant.atLeast("viewer"),
      },
      overrides: {
        File: {
          read: ({ resource, actor: actorTerm }): Rule =>
            authoredBy(resource, actorTerm),
        },
      },
    })

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: fileInTeam,
          pairs: [["file-1", "team-1"]],
        },
        {
          relation: authoredBy,
          pairs: [["file-1", "alice"]],
        },
      ],
      domain: ["file-1", "team-1", "alice"],
    })

    const runtime = evaluator(adapter, { evaluatorContext: null })
    await expect(
      runtime.evaluate(policy.ruleFor("read", "File"), {
        [actor]: "alice",
        [policy.resourceTerms.File]: "file-1",
      }),
    ).resolves.toBe(true)
  })
})

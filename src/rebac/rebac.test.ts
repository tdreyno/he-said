import {
  createInMemoryAdapter,
  evaluator,
  factIsTrue,
  fact,
  and,
  relation,
  term,
  type InMemoryRelationFacts,
  type Rule,
} from ".."
import {
  either,
  grant,
  roleTiers,
  scopedPolicy,
  through,
  resourceType,
  isResourceType,
} from "./index"

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
        memberFactsInput,
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

  it("enforces atLeast tiers in can() without requiring sourceFor wiring", async () => {
    const actor = term<User>()
    const team = term<Team>()
    const fileInTeam = relation<File, Team>()
    const memberOfTeam = relation<User, Team>()

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: fileInTeam,
          pairs: [["file-1", "team-1"]],
        },
        {
          relation: memberOfTeam,
          pairs: [
            ["viewer-user", "team-1"],
            ["editor-user", "team-1"],
          ],
          rows: [
            {
              left: "viewer-user",
              right: "team-1",
              columns: { role: "viewer" },
            },
            {
              left: "editor-user",
              right: "team-1",
              columns: { role: "editor" },
            },
          ],
        },
      ],
      domain: ["viewer-user", "editor-user", "team-1", "file-1"],
    })

    const policy = scopedPolicy<
      User,
      Team,
      { File: File },
      "read" | "update",
      "viewer" | "editor"
    >({
      actor,
      scope: team,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: {
        File: through(fileInTeam),
      },
      grants: {
        read: grant.atLeast("viewer"),
        update: grant.atLeast("editor"),
      },
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    await expect(
      policy.can("viewer-user", "read", "File", "file-1"),
    ).resolves.toBe(true)
    await expect(
      policy.can("viewer-user", "update", "File", "file-1"),
    ).resolves.toBe(false)
    await expect(
      policy.can("editor-user", "update", "File", "file-1"),
    ).resolves.toBe(true)
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

  it("supports through(...).at(...) anchors for bound intermediates", async () => {
    const node = term<string>()
    const branch = term<string>()
    const team = term<string>()
    const nodeInBranch = relation<string, string>()
    const branchInTeam = relation<string, string>()

    const anchoredPath = through(nodeInBranch).at(branch).through(branchInTeam)
    const unanchoredPath = through(nodeInBranch, branchInTeam)

    const adapter = createInMemoryAdapter({
      relations: [
        {
          relation: nodeInBranch,
          pairs: [
            ["node-1", "branch-1"],
            ["node-1", "branch-2"],
          ],
        },
        {
          relation: branchInTeam,
          pairs: [
            ["branch-1", "team-1"],
            ["branch-2", "team-2"],
          ],
        },
      ],
      domain: ["node-1", "branch-1", "branch-2", "team-1", "team-2"],
    })
    const runtime = evaluator(adapter, { evaluatorContext: null })

    await expect(
      runtime.evaluate(anchoredPath(node, team), {
        [node]: "node-1",
        [branch]: "branch-1",
        [team]: "team-1",
      }),
    ).resolves.toBe(true)

    await expect(
      runtime.evaluate(anchoredPath(node, team), {
        [node]: "node-1",
        [branch]: "branch-1",
        [team]: "team-2",
      }),
    ).resolves.toBe(false)

    await expect(
      runtime.evaluate(unanchoredPath(node, team), {
        [node]: "node-1",
        [team]: "team-2",
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

  it("supports grant.deny() for bypass-only actions", async () => {
    const actor = term<User>()
    const scope = term<Team>()
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const memberOfTeam = relation<User, Team>()
    const isAdminFact = fact<boolean>()

    const NodeResource = resourceType<NodeId, Team>({
      owner: through(nodeInTeam),
    })

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: nodeInTeam, pairs: [["n1", "team-1"]] },
        {
          relation: memberOfTeam,
          pairs: [["alice", "team-1"]],
          rows: [
            { left: "alice", right: "team-1", columns: { role: "editor" } },
          ],
        },
      ],
      domain: ["n1", "team-1", "alice", "admin-user"],
    })

    const policy = scopedPolicy({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: { Node: NodeResource },
      grants: { manage: grant.deny() },
      bypass: ({ resource }) => and(factIsTrue(isAdminFact), resource.exists()),
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    await expect(
      policy.can("alice", "manage", "Node", "n1", {
        facts: { [isAdminFact]: false },
      }),
    ).resolves.toBe(false)

    await expect(
      policy.can("alice", "manage", "Node", "n1", {
        facts: { [isAdminFact]: true },
      }),
    ).resolves.toBe(true)

    await expect(
      policy.can("admin-user", "manage", "Node", "n1", {
        facts: { [isAdminFact]: true },
      }),
    ).resolves.toBe(true)
  })

  it("grant.deny() denies when bypass is not configured", async () => {
    const actor = term<User>()
    const team = term<Team>()
    const fileInTeam = relation<File, Team>()
    const memberOfTeam = relation<User, Team>()

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: fileInTeam, pairs: [["file-1", "team-1"]] },
        {
          relation: memberOfTeam,
          pairs: [["editor-user", "team-1"]],
          rows: [
            {
              left: "editor-user",
              right: "team-1",
              columns: { role: "editor" },
            },
          ],
        },
      ],
      domain: ["editor-user", "team-1", "file-1"],
    })

    const policy = scopedPolicy<
      User,
      Team,
      { File: File },
      "manage",
      "viewer" | "editor"
    >({
      actor,
      scope: team,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: {
        File: through(fileInTeam),
      },
      grants: {
        manage: grant.deny(),
      },
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    await expect(
      policy.can("editor-user", "manage", "File", "file-1"),
    ).resolves.toBe(false)
  })
})

describe("resourceType", () => {
  type User = string
  type Team = string
  type Node = { id: string }
  type Branch = string

  it("isResourceType identifies resourceType objects", () => {
    const nodeInTeam = relation<Node, Team>()
    const NodeResource = resourceType<Node, Team>({
      table: "nodes",
      owner: through(nodeInTeam),
    })
    expect(isResourceType(NodeResource)).toBe(true)
    expect(isResourceType(through(nodeInTeam))).toBe(false)
    expect(isResourceType(null)).toBe(false)
    expect(isResourceType({ _kind: "not-resource-type" })).toBe(false)
  })

  it("stores table and key metadata", () => {
    const nodeInTeam = relation<Node, Team>()
    const NodeResource = resourceType<Node, Team>({
      table: "nodes",
      key: "node_id",
      owner: through(nodeInTeam),
    })
    expect(NodeResource.table).toBe("nodes")
    expect(NodeResource.key).toBe("node_id")
  })

  it("exposes policy.termDomains from table-backed ResourceType entries", () => {
    const actor = term<User>()
    const scope = term<Team>()
    const nodeInTeam = relation<string, Team>()
    const memberOfTeam = relation<User, Team>()
    const NodeResource = resourceType<string, Team>({
      table: "nodes",
      key: "node_id",
      owner: through(nodeInTeam),
    })
    const UntypedResource = resourceType<string, Team>({
      owner: through(nodeInTeam),
    })

    const policy = scopedPolicy({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: { Node: NodeResource, Untyped: UntypedResource },
      grants: { read: grant.atLeast("viewer") },
    })

    expect(policy.termDomains).toEqual([
      {
        term: NodeResource.term,
        table: "nodes",
        valueColumn: "node_id",
      },
    ])
  })

  it("defaults key to 'id'", () => {
    const nodeInTeam = relation<Node, Team>()
    const NodeResource = resourceType<Node, Team>({
      table: "nodes",
      owner: through(nodeInTeam),
    })
    expect(NodeResource.key).toBe("id")
  })

  it("exists() returns a Rule referencing the resource term", async () => {
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const NodeResource = resourceType<NodeId, Team>({
      owner: through(nodeInTeam),
    })
    const adapter = createInMemoryAdapter({
      relations: [{ relation: nodeInTeam, pairs: [["n1", "team-1"]] }],
      domain: ["n1", "team-1"],
    })
    const runtime = evaluator(adapter, { evaluatorContext: null })
    const existsRule = NodeResource.exists()

    await expect(
      runtime.evaluate(existsRule, { [NodeResource.term]: "n1" }),
    ).resolves.toBe(true)

    await expect(
      runtime.evaluate(existsRule, { [NodeResource.term]: "missing" }),
    ).resolves.toBe(false)
  })

  it("ownedBy() returns a Rule asserting ownership", async () => {
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const scopeTerm = term<Team>()
    const NodeResource = resourceType<NodeId, Team>({
      owner: through(nodeInTeam),
    })
    const adapter = createInMemoryAdapter({
      relations: [{ relation: nodeInTeam, pairs: [["n1", "team-1"]] }],
      domain: ["n1", "team-1"],
    })
    const runtime = evaluator(adapter, { evaluatorContext: null })
    const ownerRule = NodeResource.ownedBy(scopeTerm)

    await expect(
      runtime.evaluate(ownerRule, {
        [NodeResource.term]: "n1",
        [scopeTerm]: "team-1",
      }),
    ).resolves.toBe(true)

    await expect(
      runtime.evaluate(ownerRule, {
        [NodeResource.term]: "n1",
        [scopeTerm]: "team-2",
      }),
    ).resolves.toBe(false)
  })

  it("supports custom existence rules for composite-aware checks", async () => {
    const nodeInBranch = relation<string, Branch>()
    const branchTerm = term<Branch>()
    const NodeResource = resourceType<
      string,
      Team,
      { branchId: typeof branchTerm }
    >({
      context: { branchId: branchTerm },
      existence: (resource, context) =>
        nodeInBranch(resource, context.branchId),
      owner: through(nodeInBranch),
    })
    const adapter = createInMemoryAdapter({
      relations: [{ relation: nodeInBranch, pairs: [["n1", "branch-1"]] }],
      domain: ["n1", "branch-1", "branch-2"],
    })
    const runtime = evaluator(adapter, { evaluatorContext: null })

    await expect(
      runtime.evaluate(NodeResource.exists(), {
        [NodeResource.term]: "n1",
        [branchTerm]: "branch-1",
      }),
    ).resolves.toBe(true)

    await expect(
      runtime.evaluate(NodeResource.exists(), {
        [NodeResource.term]: "n1",
        [branchTerm]: "branch-2",
      }),
    ).resolves.toBe(false)
  })

  it("bind() maps the resource term and context terms", () => {
    const nodeInTeam = relation<string, Team>()
    const branchTerm = term<Branch>()
    const NodeResource = resourceType<
      string,
      Team,
      { branchId: typeof branchTerm }
    >({
      context: { branchId: branchTerm },
      owner: through(nodeInTeam),
    })
    // bind with context: the resource value plus an extra context key
    // We need to pass an object since context extraction uses key lookup
    const env2 = NodeResource.bind({ branchId: "branch-1" } as any)
    expect(env2[NodeResource.term as unknown as symbol]).toEqual({
      branchId: "branch-1",
    })
    expect(env2[branchTerm as unknown as symbol]).toBe("branch-1")
  })

  it("scopedPolicy accepts ResourceType in resources", async () => {
    const actor = term<User>()
    const scope = term<Team>()
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const memberOfTeam = relation<User, Team>()

    const NodeResource = resourceType<NodeId, Team>({
      table: "nodes",
      owner: through(nodeInTeam),
    })

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: nodeInTeam, pairs: [["n1", "team-1"]] },
        {
          relation: memberOfTeam,
          pairs: [
            ["alice", "team-1"],
            ["bob", "team-1"],
          ],
          rows: [
            { left: "alice", right: "team-1", columns: { role: "editor" } },
            { left: "bob", right: "team-1", columns: { role: "viewer" } },
          ],
        },
      ],
      domain: ["n1", "team-1", "alice", "bob"],
    })

    const policy = scopedPolicy({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: { Node: NodeResource },
      grants: { update: grant.atLeast("editor") },
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    // policy.resourceTerms.Node should be the same symbol as NodeResource.term
    expect(policy.resourceTerms.Node).toBe(NodeResource.term)

    await expect(policy.can("alice", "update", "Node", "n1")).resolves.toBe(
      true,
    )
    await expect(policy.can("bob", "update", "Node", "n1")).resolves.toBe(false)
  })

  it("bypass grants access regardless of membership for ResourceType resources", async () => {
    const actor = term<User>()
    const scope = term<Team>()
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const memberOfTeam = relation<User, Team>()
    const isAdminFact = fact<boolean>()

    const NodeResource = resourceType<NodeId, Team>({
      owner: through(nodeInTeam),
    })

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: nodeInTeam, pairs: [["n1", "team-1"]] },
        {
          relation: memberOfTeam,
          pairs: [["alice", "team-1"]],
          rows: [
            { left: "alice", right: "team-1", columns: { role: "viewer" } },
          ],
        },
      ],
      domain: ["n1", "team-1", "alice", "admin-user"],
    })

    const policy = scopedPolicy({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: { Node: NodeResource },
      grants: { update: grant.atLeast("editor") },
      bypass: ({ resource }) => and(factIsTrue(isAdminFact), resource.exists()),
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    // alice is only a viewer — bypass is false (isAdmin=false) so she is denied
    await expect(
      policy.can("alice", "update", "Node", "n1", {
        facts: { [isAdminFact]: false },
      }),
    ).resolves.toBe(false)

    // admin-user is not a member at all, but bypass grants access when isAdmin=true
    await expect(
      policy.can("admin-user", "update", "Node", "n1", {
        facts: { [isAdminFact]: true },
      }),
    ).resolves.toBe(true)

    // admin-user with isAdmin=false is still denied
    await expect(
      policy.can("admin-user", "update", "Node", "n1", {
        facts: { [isAdminFact]: false },
      }),
    ).resolves.toBe(false)
  })

  it("bypass does not apply to bare ScopePath resources", async () => {
    const actor = term<User>()
    const scope = term<Team>()
    type NodeId = string
    const nodeInTeam = relation<NodeId, Team>()
    const memberOfTeam = relation<User, Team>()
    const isAdminFact = fact<boolean>()

    const adapter = createInMemoryAdapter({
      relations: [
        { relation: nodeInTeam, pairs: [["n1", "team-1"]] },
        {
          relation: memberOfTeam,
          pairs: [["alice", "team-1"]],
          rows: [
            { left: "alice", right: "team-1", columns: { role: "viewer" } },
          ],
        },
      ],
      domain: ["n1", "team-1", "alice", "admin-user"],
    })

    // resources.Node is a bare ScopePath — bypass should NOT apply to it
    const policy = scopedPolicy<
      User,
      Team,
      { Node: NodeId },
      "update",
      "viewer" | "editor"
    >({
      actor,
      scope,
      membership: {
        relation: memberOfTeam,
        roleColumn: "role",
        tiers: roleTiers("viewer", "editor"),
      },
      resources: {
        Node: through(nodeInTeam),
      },
      grants: { update: grant.atLeast("editor") },
      // bypass is provided but Node is a ScopePath so it won't be called
      bypass: () => factIsTrue(isAdminFact),
      evaluator: evaluator(adapter, { evaluatorContext: null }),
    })

    // admin-user is not a team member — bypass doesn't fire for ScopePath resources
    await expect(
      policy.can("admin-user", "update", "Node", "n1", {
        facts: { [isAdminFact]: true },
      }),
    ).resolves.toBe(false)
  })
})

describe("path intermediate labels", () => {
  it("labels intermediates from the next hop's source table", async () => {
    const { relationWithSource } = await import("../core/self-describing")
    const { belongsTo } = await import("../core/algebra-postgres-helpers")
    const { getTermInfo, term: mkTerm } = await import("../core/algebra")

    const patchInBranch = relationWithSource(
      belongsTo({ table: "draft_patches", fk: "branch_id" }),
    )
    const branchInSystem = relationWithSource(
      belongsTo({ table: "branches", fk: "system_id" }),
    )

    const resource = mkTerm("patch")
    const scope = mkTerm("system")
    const rule = through(patchInBranch, branchInSystem)(resource, scope)

    // the AND's first step relates resource -> intermediate; read its label
    const first = (rule as { children: Array<{ right: symbol }> }).children[0]!
    expect(getTermInfo(first.right as never).root.description).toBe(
      "rules.term.via branches",
    )
  })

  it("falls back to positional labels for unattributed relations", () => {
    const a = relation()
    const b = relation()
    const resource = term("r")
    const scope = term("s")

    const rule = through(a, b)(resource, scope)
    const first = (rule as { children: Array<{ right: symbol }> }).children[0]!
    expect((first.right as symbol).description).toBe("rules.term.rebac.path.0")
  })
})

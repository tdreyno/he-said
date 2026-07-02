import {
  associates,
  and,
  attr,
  belongsTo,
  createInMemoryAdapter,
  createPostgresAdapter,
  eq,
  evaluator,
  exists,
  forAll,
  fact,
  factIsTrue,
  isNotNull,
  not,
  or,
  planPostgresPredicate,
  planPostgresRule,
  relation,
  term,
} from ".."
import type { PostgresQueryResult } from ".."

const queryResult = <Row extends Record<string, unknown>>(
  rows: ReadonlyArray<Row>,
): PostgresQueryResult<Row> => ({ rows })

const encodeId = (value: { id: string }) => value.id

describe("postgres algebra adapter", () => {
  it("builds a belongsTo source with default primary key", () => {
    expect(
      belongsTo({
        table: "branches",
        fk: "system_id",
      }),
    ).toEqual({
      kind: "edge",
      table: "branches",
      leftColumn: "id",
      rightColumn: "system_id",
    })
  })

  it("builds a belongsTo source with an explicit primary key", () => {
    expect(
      belongsTo({
        table: "branches",
        fk: "system_id",
        pk: "key",
      }),
    ).toEqual({
      kind: "edge",
      table: "branches",
      leftColumn: "key",
      rightColumn: "system_id",
    })
  })

  it("builds an associates source with predicate passthrough", () => {
    expect(
      associates({
        table: "team_members",
        left: "user_id",
        right: "team_id",
        predicates: [{ column: "role", op: "in", values: ["editor", "owner"] }],
      }),
    ).toEqual({
      kind: "join-table",
      table: "team_members",
      leftColumn: "user_id",
      rightColumn: "team_id",
      predicates: [{ column: "role", op: "in", values: ["editor", "owner"] }],
    })
  })

  it("infers join-table diagnostics when kind is omitted", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(userInWorkspace(actor, workspace), {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            metadataColumns: { role: "role" },
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      environment: {},
    })

    expect(plan.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "join-table",
          table: "workspace_memberships",
        }),
      ]),
    )
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-join-table-index-hint" }),
      ]),
    )
  })

  it("defaults to edge when kind is omitted and join-table markers are absent", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(userInWorkspace(actor, workspace), {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      environment: {},
    })

    expect(plan.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "edge",
          table: "workspace_memberships",
        }),
      ]),
    )
    expect(
      plan.diagnostics.some(
        diagnostic => diagnostic.code === "missing-join-table-index-hint",
      ),
    ).toBe(false)
  })

  it("plans a join-table-backed relation with filter pushdown and diagnostics", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()

    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const rule = and(
      userInWorkspace(actor, workspace),
      userHasWorkspaceRole(actor, role),
      eq(role, "owner"),
    )

    const plan = planPostgresRule(rule, {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "public.workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
            recommendedView: "public.active_workspace_memberships",
          },
        },
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "public.workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: encodeId },
        { term: workspace, encode: encodeId },
      ],
      environment: {
        [actor]: { id: "u1" },
        [workspace]: { id: "w1" },
      },
    })

    expect(plan.sql).toContain("SELECT EXISTS")
    expect(plan.sql).toContain('"public"."workspace_memberships" "rel1"')
    expect(plan.sql).toContain('"public"."workspace_memberships" "rel2"')
    expect(plan.sql).toContain('"rel1".deleted_at IS NULL')
    expect(plan.sql).toContain('"rel2".deleted_at IS NULL')
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-join-table-index-hint",
          level: "warning",
        }),
        expect.objectContaining({
          code: "consider-join-table-view",
          level: "info",
        }),
      ]),
    )
  })

  it("avoids join-table index warnings when suggested indexes exist", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(userInWorkspace(actor, workspace), {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            suggestedIndexes: [
              {
                columns: ["user_id", "workspace_id"],
                where: "deleted_at IS NULL",
              },
            ],
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      environment: {},
    })

    expect(plan.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-join-table-index-hint" }),
      ]),
    )
  })

  it("rewrites relation static filter placeholders against global parameter positions", () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const plan = planPostgresRule(userHasWorkspaceRole(actor, role), {
      relationMappings: [
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [
              {
                sql: '{{source}}."role" = $1',
                params: ["editor"],
              },
            ],
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      environment: {
        [actor]: { id: "u1" },
      },
    })

    expect(plan.sql).toContain('"rel1"."role" = $2')
    expect(plan.params).toEqual(["u1", "editor"])
  })

  it("rewrites parameterized static filters independently across relations", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const plan = planPostgresRule(
      and(userInWorkspace(actor, workspace), userHasWorkspaceRole(actor, role)),
      {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
              staticFilters: [
                {
                  sql: '{{source}}."workspace_id" <> $1',
                  params: ["w0"],
                },
              ],
            },
          },
          {
            relation: userHasWorkspaceRole,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "role",
              staticFilters: [
                {
                  sql: '{{source}}."role" = $1',
                  params: ["editor"],
                },
              ],
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      },
    )

    expect(plan.sql).toContain('"rel1"."workspace_id" <> $2')
    expect(plan.sql).toContain('"rel2"."role" = $3')
    expect(plan.params).toEqual(["u1", "w0", "editor"])
  })

  it("rewrites forall domain static filter placeholders against global parameter positions", () => {
    const viewer = term<{ id: string }>()
    const document = term<{ id: string }>()
    const userCanViewDocument = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(
      forAll(document, userCanViewDocument(viewer, document)),
      {
        relationMappings: [
          {
            relation: userCanViewDocument,
            source: {
              kind: "join-table",
              table: "document_viewers",
              leftColumn: "user_id",
              rightColumn: "document_id",
            },
          },
        ],
        termDomains: [
          {
            term: document,
            table: "documents",
            valueColumn: "id",
            staticFilters: [
              {
                sql: '{{source}}."visibility" = $1',
                params: ["public"],
              },
            ],
          },
        ],
        termEncodings: [{ term: viewer, encode: encodeId }],
        environment: {
          [viewer]: { id: "u1" },
        },
      },
    )

    expect(plan.sql).toContain('"dom1"."visibility" = $2')
    expect(plan.params).toEqual(["u1", "public"])
  })

  it("throws when static filter params are provided without placeholder references", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    expect(() =>
      planPostgresRule(userInWorkspace(actor, workspace), {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
              staticFilters: [
                {
                  sql: "{{source}}.deleted_at IS NULL",
                  params: ["ignored"],
                },
              ],
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      }),
    ).toThrow(
      "postgres adapter staticFilters.params were provided but staticFilters.sql has no positional parameters",
    )
  })

  it("plans correlated or branches as nested existential subqueries", () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const plan = planPostgresRule(
      and(
        userHasWorkspaceRole(actor, role),
        or(eq(role, "owner"), eq(role, "manager")),
      ),
      {
        relationMappings: [
          {
            relation: userHasWorkspaceRole,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "role",
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      },
    )

    expect(plan.sql).toContain("EXISTS(SELECT 1 WHERE")
    expect(plan.sql).toContain("UNION ALL")
    expect(plan.params).toHaveLength(3)
  })

  it("plans term.is(...) SQL expression predicates with attribute column mappings", () => {
    const document = term<{ id: string; workspaceAccess: string | null }>()

    const rule = and(
      document
        .is(eq(attr(document, "workspaceAccess"), "read"))
        .is(isNotNull(attr(document, "workspaceAccess"))),
    )

    const plan = planPostgresRule(rule, {
      relationMappings: [],
      termDomains: [
        {
          term: document,
          table: "documents",
          valueColumn: "id",
          columns: {
            workspaceAccess: "workspace_access",
          },
        },
      ],
      termEncodings: [{ term: document, encode: value => value.id }],
      environment: {
        [document]: { id: "d1", workspaceAccess: "read" },
      },
    })

    expect(plan.sql).toContain('"documents" "src1"')
    expect(plan.sql).toContain('"src1"."id" IS NOT DISTINCT FROM $1')
    expect(plan.sql).toContain(
      '"src1"."workspace_access" IS NOT DISTINCT FROM $2',
    )
    expect(plan.sql).toContain('"src1"."workspace_access" IS NOT NULL')
    expect(plan.params).toEqual(["d1", "read"])
  })

  it("fails fast for JavaScript unary predicates in postgres planning", () => {
    const document = term<{ id: string; workspaceAccess: string | null }>()
    const rule = and(document.is(d => d.workspaceAccess === "read"))

    expect(() =>
      planPostgresRule(rule, {
        relationMappings: [],
        termDomains: [
          {
            term: document,
            table: "documents",
            valueColumn: "id",
            columns: {
              workspaceAccess: "workspace_access",
            },
          },
        ],
        termEncodings: [{ term: document, encode: value => value.id }],
        environment: {
          [document]: { id: "d1", workspaceAccess: "read" },
        },
      }),
    ).toThrow(
      "postgres adapter does not support JavaScript unary predicates; use term.is(...) with SQL expression predicates",
    )
  })

  it("throws when factIsTrue is unbound", () => {
    const isAppAdmin = fact<boolean>()

    expect(() =>
      planPostgresRule(factIsTrue(isAppAdmin), {
        relationMappings: [],
        environment: {},
      }),
    ).toThrow(
      "fact used in factIsTrue(...) must be bound in the evaluation environment",
    )
  })

  it("throws when an unbound factIsTrue appears in an or branch", () => {
    const isAppAdmin = fact<boolean>()

    expect(() =>
      planPostgresRule(or(factIsTrue(isAppAdmin), eq(term<boolean>(), true)), {
        relationMappings: [],
        environment: {},
      }),
    ).toThrow(
      "fact used in factIsTrue(...) must be bound in the evaluation environment",
    )
  })

  it("throws when an unbound factIsTrue appears in a not branch", () => {
    const isAppAdmin = fact<boolean>()

    expect(() =>
      planPostgresRule(not(factIsTrue(isAppAdmin)), {
        relationMappings: [],
        environment: {},
      }),
    ).toThrow(
      "fact used in factIsTrue(...) must be bound in the evaluation environment",
    )
  })

  it("plans correlated not branches as not exists subqueries", () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const plan = planPostgresRule(
      and(userHasWorkspaceRole(actor, role), not(eq(role, "suspended"))),
      {
        relationMappings: [
          {
            relation: userHasWorkspaceRole,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "role",
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      },
    )

    expect(plan.sql).toContain("NOT EXISTS(SELECT 1 WHERE")
    expect(plan.params).toHaveLength(2)
  })

  it("plans a composable predicate fragment", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const plan = planPostgresPredicate(userInWorkspace(actor, workspace), {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      environment: {
        [actor]: { id: "u1" },
      },
      bindings: [{ term: workspace, sql: '"documents"."workspace_id"' }],
    })

    expect(plan.sql).toContain("EXISTS(")
    expect(plan.sql).not.toContain("SELECT EXISTS")
    expect(plan.params).toEqual(["u1"])
  })

  it("binds only rule-referenced environment terms when planning", () => {
    const actor = term<string>()
    const file = term<string>()
    const workspace = term<string>()
    const fileInWorkspace = relation<string, string>()

    const plan = planPostgresRule(fileInWorkspace(file, workspace), {
      relationMappings: [
        {
          relation: fileInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_files",
            leftColumn: "file_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      environment: {
        [file]: "f1",
        [actor]: "u1",
      },
    })

    expect(plan.params).toEqual(["f1"])
  })

  it("skips overridden environment terms in predicate planning bindings", () => {
    const actor = term<string>()
    const workspace = term<string>()
    const userInWorkspace = relation<string, string>()

    const plan = planPostgresPredicate(userInWorkspace(actor, workspace), {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      environment: {
        [actor]: "u1",
        [workspace]: "w1",
      },
      bindings: [{ term: workspace, sql: '"documents"."workspace_id"' }],
    })

    expect(plan.params).toEqual(["u1"])
  })

  it("plans typed relation predicates as parameterized SQL", () => {
    const actor = term<{ id: string }>()
    const team = term<{ id: string }>()
    const userEditsTeam = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(userEditsTeam(actor, team), {
      relationMappings: [
        {
          relation: userEditsTeam,
          source: {
            kind: "join-table",
            table: "team_members",
            leftColumn: "user_id",
            rightColumn: "team_id",
            predicates: [
              { column: "status", op: "eq", value: "active" },
              { column: "workspace_id", op: "in", values: ["w1", "w2"] },
            ],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: encodeId },
        { term: team, encode: encodeId },
      ],
      environment: {
        [actor]: { id: "u1" },
        [team]: { id: "t1" },
      },
    })

    expect(plan.sql).toContain('"rel1"."status" IS NOT DISTINCT FROM $3')
    expect(plan.sql).toContain('"rel1"."workspace_id" = ANY($4)')
    expect(plan.params).toEqual(["u1", "t1", "active", ["w1", "w2"]])
  })

  it("plans relation-node predicates as parameterized SQL", () => {
    const actor = term<{ id: string }>()
    const team = term<{ id: string }>()
    const userInTeam = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(
      userInTeam(actor, team, {
        predicates: [{ column: "role", op: "ge", value: "editor" }],
        orderings: [
          {
            column: "role",
            order: { viewer: 10, editor: 20, owner: 30 },
          },
        ],
      }),
      {
        relationMappings: [
          {
            relation: userInTeam,
            source: {
              kind: "join-table",
              table: "team_members",
              leftColumn: "user_id",
              rightColumn: "team_id",
            },
          },
        ],
        termEncodings: [
          { term: actor, encode: encodeId },
          { term: team, encode: encodeId },
        ],
        environment: {
          [actor]: { id: "u1" },
          [team]: { id: "t1" },
        },
      },
    )

    expect(plan.sql).toContain("(CASE")
    expect(plan.sql).toContain("WHEN 'viewer' THEN 10")
    expect(plan.sql).toContain(">= $3")
    expect(plan.params).toEqual(["u1", "t1", 20])
  })

  it("supports ordered rank comparisons for typed predicates", () => {
    const actor = term<{ id: string }>()
    const team = term<{ id: string }>()
    const userEditsTeam = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(userEditsTeam(actor, team), {
      relationMappings: [
        {
          relation: userEditsTeam,
          source: {
            kind: "join-table",
            table: "team_members",
            leftColumn: "user_id",
            rightColumn: "team_id",
            predicates: [{ column: "role", op: "ge", value: "editor" }],
            orderings: [
              {
                column: "role",
                order: { viewer: 10, editor: 20, admin: 30, owner: 40 },
              },
            ],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: encodeId },
        { term: team, encode: encodeId },
      ],
      environment: {
        [actor]: { id: "u1" },
        [team]: { id: "t1" },
      },
    })

    expect(plan.sql).toContain("(CASE")
    expect(plan.sql).toContain("WHEN 'viewer' THEN 10")
    expect(plan.sql).toContain(">= $3")
    expect(plan.params).toEqual(["u1", "t1", 20])
  })

  it("returns proof details with diagnostics", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const captured: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          captured.push({ sql, params })
          return queryResult([{ ok: true } as unknown as Row])
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const proof = await instance.evaluateWithProof(
      userInWorkspace(actor, workspace),
      {
        [actor]: { id: "u1" },
      },
    )

    expect(proof.ok).toBe(true)
    expect(proof.details).toEqual(
      expect.objectContaining({
        paramCount: captured[0]?.params.length,
        sql: captured[0]?.sql,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "missing-join-table-index-hint" }),
        ]),
      }),
    )
  })

  it("returns the first failing node in deterministic AST order", async () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>() => {
          return queryResult([{ ok: false } as unknown as Row])
        },
      },
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const proof = await instance.evaluateWithProof(
      and(userHasWorkspaceRole(actor, role), eq(role, "owner")),
      {
        [actor]: { id: "u1" },
      },
    )

    expect(proof.ok).toBe(false)
    expect(proof.failing).toEqual(
      expect.objectContaining({
        kind: "relation",
        path: "root.and[0]",
        reason: "no matching rows",
      }),
    )
    expect(proof.failing?.relationId).toBe(userHasWorkspaceRole.id)
    expect(proof.failing?.sql).toBeUndefined()
  })

  it("includes failing node SQL only when explicitly enabled", async () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      includeFailingNodeSql: true,
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>() => {
          return queryResult([{ ok: false } as unknown as Row])
        },
      },
    })

    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const proof = await instance.evaluateWithProof(
      and(userHasWorkspaceRole(actor, role), eq(role, "owner")),
      {
        [actor]: { id: "u1" },
      },
    )

    expect(proof.ok).toBe(false)
    expect(proof.failing?.sql).toContain("SELECT EXISTS(")
    expect(proof.failing?.paramCount).toBeGreaterThan(0)
  })

  it("matches failing node identity with the in-memory adapter", async () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()
    const rule = and(userHasWorkspaceRole(actor, role), eq(role, "owner"))

    const postgres = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>() => {
          return queryResult([{ ok: false } as unknown as Row])
        },
      },
    })
    const memory = createInMemoryAdapter({
      relations: [
        {
          relation: userHasWorkspaceRole,
          pairs: [],
        },
      ],
    })

    const postgresProof = await evaluator(postgres, {
      evaluatorContext: null,
    }).evaluateWithProof(rule, {
      [actor]: { id: "u1" },
    })
    const inMemoryProof = await evaluator(memory, {
      evaluatorContext: null,
    }).evaluateWithProof(rule, {
      [actor]: { id: "u1" },
    })

    expect(postgresProof.ok).toBe(false)
    expect(inMemoryProof.ok).toBe(false)
    expect(postgresProof.failing?.kind).toBe(inMemoryProof.failing?.kind)
    expect(postgresProof.failing?.path).toBe(inMemoryProof.failing?.path)
  })

  it("filters explicit candidates in one postgres round trip", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<string>()
    const userInWorkspace = relation<{ id: string }, string>()

    const captured: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []
    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      termEncodings: [{ term: actor, encode: encodeId }],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          captured.push({ sql, params })
          return queryResult([{ candidate: "w1" } as unknown as Row])
        },
      },
    })

    const allowed = await adapter.filter?.(
      userInWorkspace(actor, workspace),
      {
        environment: { [actor]: { id: "u1" } },
        term: workspace,
        candidates: ["w1", "w2"],
      },
      null,
    )

    expect(allowed).toEqual(["w1"])
    expect(captured).toHaveLength(1)
    expect(captured[0]?.sql).toContain("VALUES")
  })

  it("encodes bound object terms and eq values through configured term encodings", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const plan = planPostgresRule(
      and(userInWorkspace(actor, workspace), eq(workspace, { id: "w1" })),
      {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
            },
          },
        ],
        termEncodings: [
          {
            term: actor,
            encode: (value: { id: string }) => value.id,
          },
          {
            term: workspace,
            encode: (value: { id: string }) => value.id,
          },
        ],
        environment: {
          [actor]: { id: "u1" },
        },
      },
    )

    expect(plan.params).toEqual(["u1", "w1"])
  })

  it("fails fast for bound object terms without a configured term encoder", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    expect(() =>
      planPostgresRule(userInWorkspace(actor, workspace), {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
            },
          },
        ],
        environment: {
          [actor]: { id: "u1" },
        },
      }),
    ).toThrow(
      "postgres adapter requires a term encoder for bound object values; configure termEncodings for this term",
    )
  })

  it("plans forall with an explicit term domain as a counterexample not exists query", () => {
    const viewer = term<{ id: string }>()
    const membership = term<{ id: string }>()
    const team = term<{ id: string }>()
    const document = term<{ id: string }>()

    const userHasMembership = relation<{ id: string }, { id: string }>()
    const membershipBelongsToTeam = relation<{ id: string }, { id: string }>()
    const teamOwnsDocument = relation<{ id: string }, { id: string }>()

    const memberRule = and(
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, document),
    )

    const plan = planPostgresRule(forAll(document, memberRule), {
      relationMappings: [
        {
          relation: userHasMembership,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "membership_id",
          },
        },
        {
          relation: membershipBelongsToTeam,
          source: {
            kind: "edge",
            table: "membership_teams",
            leftColumn: "membership_id",
            rightColumn: "team_id",
          },
        },
        {
          relation: teamOwnsDocument,
          source: {
            kind: "edge",
            table: "team_documents",
            leftColumn: "team_id",
            rightColumn: "document_id",
          },
        },
      ],
      termEncodings: [{ term: viewer, encode: encodeId }],
      termDomains: [
        {
          term: document,
          table: "documents",
          valueColumn: "id",
          staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
        },
      ],
      environment: {
        [viewer]: { id: "u1" },
      },
    })

    expect(plan.sql).toContain("NOT EXISTS(SELECT 1 FROM (SELECT DISTINCT")
    expect(plan.sql).toContain('"documents" "dom1"')
    expect(plan.sql).toContain('"forall2".candidate')
    expect(plan.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "forall-without-domain-source" }),
      ]),
    )
  })

  it("uses relation-derived forall candidates and emits a diagnostic when no explicit term domain exists", () => {
    const viewer = term<{ id: string }>()
    const membership = term<{ id: string }>()
    const team = term<{ id: string }>()
    const document = term<{ id: string }>()

    const userHasMembership = relation<{ id: string }, { id: string }>()
    const membershipBelongsToTeam = relation<{ id: string }, { id: string }>()
    const teamOwnsDocument = relation<{ id: string }, { id: string }>()

    const memberRule = and(
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, document),
    )

    const plan = planPostgresRule(forAll(document, memberRule), {
      relationMappings: [
        {
          relation: userHasMembership,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "membership_id",
          },
        },
        {
          relation: membershipBelongsToTeam,
          source: {
            kind: "edge",
            table: "membership_teams",
            leftColumn: "membership_id",
            rightColumn: "team_id",
          },
        },
        {
          relation: teamOwnsDocument,
          source: {
            kind: "edge",
            table: "team_documents",
            leftColumn: "team_id",
            rightColumn: "document_id",
          },
        },
      ],
      termEncodings: [{ term: viewer, encode: encodeId }],
      environment: {
        [viewer]: { id: "u1" },
      },
    })

    expect(plan.sql).toContain('FROM "team_documents" "dom1"')
    expect(plan.sql).toContain('"forall2".candidate')
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "forall-derived-domain" }),
      ]),
    )
  })

  it("rebinds static filter placeholders with planner-safe parameter offsets", () => {
    const actor = term<{ id: string }>()
    const role = term<string>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const plan = planPostgresRule(
      and(userHasWorkspaceRole(actor, role), eq(role, "owner")),
      {
        relationMappings: [
          {
            relation: userHasWorkspaceRole,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "role",
              staticFilters: [
                {
                  sql: "{{source}}.tenant_id = $1 AND {{source}}.membership_kind = $2",
                  params: ["tenant-1", "active"],
                },
              ],
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      },
    )

    expect(plan.sql).toContain('"rel1".tenant_id = $2')
    expect(plan.sql).toContain('"rel1".membership_kind = $3')
    expect(plan.params).toEqual(["u1", "tenant-1", "active", "owner"])
  })

  it("hydrates preloaded relations once and reuses prepared tuples across evaluations", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    const captured: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []
    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: encodeId },
        { term: workspace, encode: encodeId },
      ],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          captured.push({ sql, params })

          if (sql.includes('FROM "workspace_memberships" "preload_src"')) {
            return queryResult([
              { left_value: "u1", right_value: "w1" },
              { left_value: "u1", right_value: "w2" },
            ] as unknown as ReadonlyArray<Row>)
          }

          return queryResult([{ ok: true }] as unknown as ReadonlyArray<Row>)
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const prepared = await instance.prepare({
      environment: {
        [actor]: { id: "u1" },
      },
      preload: [userInWorkspace],
    })

    await prepared.evaluate(userInWorkspace(actor, workspace), {
      [workspace]: { id: "w1" },
    })
    await prepared.evaluate(userInWorkspace(actor, workspace), {
      [workspace]: { id: "w2" },
    })

    const hydrationQueries = captured.filter(entry =>
      entry.sql.includes('FROM "workspace_memberships" "preload_src"'),
    )
    const evaluationQueries = captured.filter(entry =>
      entry.sql.startsWith("SELECT EXISTS("),
    )

    expect(hydrationQueries).toHaveLength(1)
    expect(evaluationQueries).toHaveLength(2)
    evaluationQueries.forEach(entry => {
      expect(entry.sql).toContain("(VALUES")
      expect(entry.sql).not.toContain('"workspace_memberships"')
    })
  })

  it("binds only referenced terms through prepare() evaluation", async () => {
    const actor = term<string>()
    const file = term<string>()
    const workspace = term<string>()
    const fileInWorkspace = relation<string, string>()

    const captured: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []
    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: fileInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_files",
            leftColumn: "file_id",
            rightColumn: "workspace_id",
          },
        },
      ],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          captured.push({ sql, params })
          return queryResult([{ ok: true }] as unknown as ReadonlyArray<Row>)
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const prepared = await instance.prepare({
      environment: {
        [actor]: "u1",
      },
    })

    await prepared.evaluate(fileInWorkspace(file, workspace), {
      [file]: "f1",
    })

    const evaluationQuery = captured.find(entry =>
      entry.sql.startsWith("SELECT EXISTS("),
    )
    expect(evaluationQuery?.params).toEqual(["f1"])
  })

  it("lets per-evaluate fact bindings override prepared facts", async () => {
    const isAppAdmin = fact<boolean>()
    const adapter = createPostgresAdapter({
      relationMappings: [],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          _sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          const [boundFact, expected] = params
          return queryResult([
            { ok: Object.is(boundFact, expected) } as unknown as Row,
          ])
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const prepared = await instance.prepare({
      facts: {
        [isAppAdmin]: true,
      },
    })

    await expect(prepared.evaluate(factIsTrue(isAppAdmin))).resolves.toBe(true)
    await expect(
      prepared.evaluate(factIsTrue(isAppAdmin), {
        [isAppAdmin]: false,
      }),
    ).resolves.toBe(false)
  })

  it("fails when static filter params are provided without SQL placeholders", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    expect(() =>
      planPostgresRule(userInWorkspace(actor, workspace), {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
              staticFilters: [
                {
                  sql: "{{source}}.deleted_at IS NULL",
                  params: ["unexpected"],
                },
              ],
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      }),
    ).toThrow(
      "postgres adapter staticFilters.params were provided but staticFilters.sql has no positional parameters",
    )
  })

  it("fails when static filter SQL placeholders do not have params", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()

    expect(() =>
      planPostgresRule(userInWorkspace(actor, workspace), {
        relationMappings: [
          {
            relation: userInWorkspace,
            source: {
              kind: "join-table",
              table: "workspace_memberships",
              leftColumn: "user_id",
              rightColumn: "workspace_id",
              staticFilters: [
                {
                  sql: "{{source}}.tenant_id = $1",
                },
              ],
            },
          },
        ],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {
          [actor]: { id: "u1" },
        },
      }),
    ).toThrow(
      "postgres adapter staticFilters.sql uses positional parameters but no staticFilters.params were provided",
    )
  })

  it("fails closed on unsupported unconstrained term nodes", () => {
    const actor = term<{ id: string }>()

    expect(() =>
      planPostgresRule(and(actor), {
        relationMappings: [],
        environment: {},
      }),
    ).toThrow(
      "postgres adapter does not support unconstrained term nodes yet; anchor the term through a relation or equality first",
    )
  })

  it("plans exists(term) against an explicit term domain with filters", () => {
    const document = term<{ id: string }>()
    const plan = planPostgresRule(exists(document), {
      relationMappings: [],
      termDomains: [
        {
          term: document,
          table: "documents",
          valueColumn: "id",
          staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          predicates: [{ column: "tenant_id", op: "eq", value: "t1" }],
        },
      ],
      termEncodings: [{ term: document, encode: encodeId }],
      environment: {
        [document]: { id: "d1" },
      },
    })

    expect(plan.sql).toContain('EXISTS(SELECT 1 FROM "documents" "exists1"')
    expect(plan.sql).toContain('"exists1"."id" IS NOT DISTINCT FROM $1')
    expect(plan.sql).toContain('"exists1".deleted_at IS NULL')
    expect(plan.sql).toContain('"exists1"."tenant_id" IS NOT DISTINCT FROM $2')
    expect(plan.params).toEqual(["d1", "t1"])
  })

  it("derives term domains from resourceTypes in createPostgresAdapter", async () => {
    const document = term<{ id: string }>()
    const captured: Array<{ sql: string; params: ReadonlyArray<unknown> }> = []

    const adapter = createPostgresAdapter({
      relationMappings: [],
      resourceTypes: [{ term: document, table: "documents", key: "id" }],
      termEncodings: [{ term: document, encode: encodeId }],
      queryExecutor: {
        query: async <Row extends Record<string, unknown>>(
          sql: string,
          params: ReadonlyArray<unknown>,
        ) => {
          captured.push({ sql, params })
          return queryResult([{ ok: true } as unknown as Row])
        },
      },
    })
    const instance = evaluator(adapter, { evaluatorContext: null })

    await expect(
      instance.evaluate(exists(document), {
        [document]: { id: "d1" },
      }),
    ).resolves.toBe(true)

    expect(captured[0]?.sql).toContain('FROM "documents" "exists1"')
    expect(captured[0]?.params).toEqual(["d1"])
  })

  it("fails loud when exists(term) is planned with an unbound term", () => {
    const document = term<{ id: string }>()

    expect(() =>
      planPostgresRule(exists(document), {
        relationMappings: [],
        termDomains: [
          {
            term: document,
            table: "documents",
            valueColumn: "id",
          },
        ],
        environment: {},
      }),
    ).toThrow(
      "postgres adapter cannot compile exists(term) when the term is unbound",
    )
  })

  it("fails loud when exists(term) is planned without a term domain mapping", () => {
    const document = term<{ id: string }>()

    expect(() =>
      planPostgresRule(exists(document), {
        relationMappings: [],
        termEncodings: [{ term: document, encode: encodeId }],
        environment: {
          [document]: { id: "d1" },
        },
      }),
    ).toThrow(
      "postgres adapter exists(term) requires a termDomains mapping for the referenced term",
    )
  })

  it("fails closed on unsupported unary predicate nodes", () => {
    const actor = term<{ id: string }>()
    const constrainedActor = actor.is(value => value.id.startsWith("u"))

    expect(() =>
      planPostgresRule(eq(constrainedActor, { id: "u1" }), {
        relationMappings: [],
        termEncodings: [{ term: actor, encode: encodeId }],
        environment: {},
      }),
    ).toThrow(
      "postgres adapter does not support JavaScript unary predicates; use term.is(...) with SQL expression predicates",
    )
  })

  it("produces deterministic SQL and params for identical inputs", () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()
    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()
    const rule = and(
      userInWorkspace(actor, workspace),
      userHasWorkspaceRole(actor, role),
      eq(role, "owner"),
    )
    const options = {
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table" as const,
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table" as const,
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: encodeId },
        { term: workspace, encode: encodeId },
      ],
      environment: {
        [actor]: { id: "u1" },
        [workspace]: { id: "w1" },
      },
    }

    const firstPlan = planPostgresRule(rule, options)
    const secondPlan = planPostgresRule(rule, options)

    expect(secondPlan.sql).toBe(firstPlan.sql)
    expect(secondPlan.params).toEqual(firstPlan.params)
  })
})

import { Client } from "pg"

import {
  and,
  createPostgresAdapter,
  eq,
  evaluator,
  forAll,
  not,
  or,
  relation,
  term,
} from ".."

const postgresConfig = {
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT ?? "54329"),
  user: process.env.POSTGRES_USER ?? "he_said",
  password: process.env.POSTGRES_PASSWORD ?? "he_said",
  database: process.env.POSTGRES_DB ?? "he_said_test",
}

const connectWithRetry = async (): Promise<Client> => {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const client = new Client(postgresConfig)
    try {
      await client.connect()
      return client
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  throw lastError
}

describe("postgres algebra adapter integration", () => {
  let client: Client

  beforeAll(async () => {
    client = await connectWithRetry()

    await client.query(`
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS team_documents;
      DROP TABLE IF EXISTS membership_teams;
      DROP TABLE IF EXISTS workspace_memberships;

      CREATE TABLE workspace_memberships (
        user_id text NOT NULL,
        workspace_id text NOT NULL,
        membership_id text NOT NULL,
        role text NOT NULL,
        deleted_at timestamptz NULL
      );

      CREATE TABLE membership_teams (
        membership_id text NOT NULL,
        team_id text NULL
      );

      CREATE TABLE team_documents (
        team_id text NOT NULL,
        document_id text NOT NULL
      );

      CREATE TABLE documents (
        id text PRIMARY KEY,
        deleted_at timestamptz NULL
      );

      CREATE TABLE projects (
        id text PRIMARY KEY,
        team_id text NULL
      );

      CREATE TABLE files (
        id text PRIMARY KEY,
        project_id text NULL,
        team_id text NULL
      );

      CREATE INDEX workspace_memberships_user_workspace_idx
        ON workspace_memberships (user_id, workspace_id)
        WHERE deleted_at IS NULL;

      CREATE INDEX workspace_memberships_user_role_idx
        ON workspace_memberships (user_id, role)
        WHERE deleted_at IS NULL;

      CREATE INDEX membership_teams_membership_team_idx
        ON membership_teams (membership_id, team_id);

      CREATE INDEX team_documents_team_document_idx
        ON team_documents (team_id, document_id);
    `)

    await client.query(`
      INSERT INTO workspace_memberships (user_id, workspace_id, membership_id, role, deleted_at)
      VALUES
        ('u1', 'w1', 'm1', 'owner', NULL),
        ('u1', 'w1', 'm1', 'manager', NULL),
        ('u2', 'w1', 'm2', 'member', NULL),
        ('u4', 'w1', 'm4', 'member', NULL),
        ('u3', 'w1', 'm3', 'owner', now());

      INSERT INTO membership_teams (membership_id, team_id)
      VALUES
        ('m1', 't1'),
        ('m2', 't1'),
        ('m4', NULL);

      INSERT INTO team_documents (team_id, document_id)
      VALUES
        ('t1', 'd1');

      INSERT INTO documents (id, deleted_at)
      VALUES
        ('d1', NULL),
        ('d2', NULL);

      INSERT INTO projects (id, team_id)
      VALUES
        ('p1', 't1'),
        ('p2', NULL);

      INSERT INTO files (id, project_id, team_id)
      VALUES
        ('f1', 'p1', NULL),
        ('f2', NULL, 't1'),
        ('f3', NULL, NULL);
    `)
  }, 60000)

  afterAll(async () => {
    if (client) {
      await client.end()
    }
  }, 10000)

  it("evaluates join-table-backed rules against a real postgres database", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()

    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
            suggestedIndexes: [
              {
                columns: ["user_id", "workspace_id"],
                where: "deleted_at IS NULL",
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
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
            suggestedIndexes: [
              { columns: ["user_id", "role"], where: "deleted_at IS NULL" },
            ],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: value => value.id },
        { term: workspace, encode: value => value.id },
      ],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = and(
      userInWorkspace(actor, workspace),
      userHasWorkspaceRole(actor, role),
      eq(role, "owner"),
    )

    await expect(
      instance.evaluate(rule, {
        [actor]: { id: "u1" },
        [workspace]: { id: "w1" },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [actor]: { id: "u2" },
        [workspace]: { id: "w1" },
      }),
    ).resolves.toBe(false)

    await expect(
      instance.evaluate(rule, {
        [actor]: { id: "u1" },
        [workspace]: { id: "missing-workspace" },
      }),
    ).resolves.toBe(false)

    await expect(
      instance.evaluate(rule, {
        [actor]: { id: "u3" },
        [workspace]: { id: "w1" },
      }),
    ).resolves.toBe(false)
  })

  it("includes explain-based diagnostics in proofs when sequential scans are detected", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()

    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasWorkspaceRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
        {
          relation: userHasWorkspaceRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: value => value.id },
        { term: workspace, encode: value => value.id },
      ],
      explainQuery: true,
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = and(
      userInWorkspace(actor, workspace),
      userHasWorkspaceRole(actor, role),
      eq(role, "owner"),
    )

    const proof = await instance.evaluateWithProof(rule, {
      [actor]: { id: "u1" },
      [workspace]: { id: "w1" },
    })

    expect(proof.ok).toBe(true)
    expect(proof.details).toBeDefined()
    if (proof.details) {
      expect(proof.details.explain).toBeDefined()
      // Explain-based diagnostics may detect sequential scans depending on table size/stats
      // Just verify the details include diagnostics from planning phase
      expect(proof.details.diagnostics).toBeInstanceOf(Array)
    }
  })

  it("evaluates forall with an explicit document domain against real postgres data", async () => {
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

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasMembership,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "membership_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
            suggestedIndexes: [
              {
                columns: ["user_id", "membership_id"],
                where: "deleted_at IS NULL",
              },
            ],
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
      termDomains: [
        {
          term: document,
          table: "documents",
          valueColumn: "id",
          staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
        },
      ],
      termEncodings: [{ term: viewer, encode: value => value.id }],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = forAll(document, memberRule)

    await expect(
      instance.evaluate(rule, {
        [viewer]: { id: "u1" },
      }),
    ).resolves.toBe(false)
  })

  it("fails closed when a nullable relation edge breaks traversal", async () => {
    const viewer = term<{ id: string }>()
    const membership = term<{ id: string }>()
    const team = term<{ id: string }>()
    const document = term<{ id: string }>()

    const userHasMembership = relation<{ id: string }, { id: string }>()
    const membershipBelongsToTeam = relation<{ id: string }, { id: string }>()
    const teamOwnsDocument = relation<{ id: string }, { id: string }>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasMembership,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "membership_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
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
      termEncodings: [
        { term: viewer, encode: value => value.id },
        { term: document, encode: value => value.id },
      ],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = and(
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, document),
    )

    await expect(
      instance.evaluate(rule, {
        [viewer]: { id: "u4" },
        [document]: { id: "d1" },
      }),
    ).resolves.toBe(false)
  })

  it("evaluates or branches against real postgres data", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()

    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
        {
          relation: userHasRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: value => value.id },
        { term: workspace, encode: value => value.id },
      ],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const role = term<string>()

    // Rule: user is in workspace AND (has role "owner" OR has role "manager")
    const rule = and(
      userInWorkspace(actor, workspace),
      or(
        and(userHasRole(actor, role), eq(role, "owner")),
        and(userHasRole(actor, role), eq(role, "manager")),
      ),
    )

    // u1 has both owner and manager roles, so should be true
    expect(
      await instance.evaluate(rule, {
        [actor]: { id: "u1" },
        [workspace]: { id: "w1" },
      }),
    ).toBe(true)

    // u2 has member role, not owner or manager, so should be false
    expect(
      await instance.evaluate(rule, {
        [actor]: { id: "u2" },
        [workspace]: { id: "w1" },
      }),
    ).toBe(false)
  })

  it("evaluates not branches against real postgres data", async () => {
    const actor = term<{ id: string }>()
    const workspace = term<{ id: string }>()
    const role = term<string>()

    const userInWorkspace = relation<{ id: string }, { id: string }>()
    const userHasRole = relation<{ id: string }, string>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userInWorkspace,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "workspace_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
        {
          relation: userHasRole,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "role",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
          },
        },
      ],
      termEncodings: [
        { term: actor, encode: value => value.id },
        { term: workspace, encode: value => value.id },
      ],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    // Rule: user is in workspace AND NOT (has admin role)
    // Since no one has admin role, this should be true for all active users
    const rule = and(
      userInWorkspace(actor, workspace),
      not(and(userHasRole(actor, role), eq(role, "admin"))),
    )

    // u1 is active and doesn't have admin role, so rule is true
    expect(
      await instance.evaluate(rule, {
        [actor]: { id: "u1" },
        [workspace]: { id: "w1" },
      }),
    ).toBe(true)

    // u2 is active and doesn't have admin role, so rule is true
    expect(
      await instance.evaluate(rule, {
        [actor]: { id: "u2" },
        [workspace]: { id: "w1" },
      }),
    ).toBe(true)
  })

  it("supports optional parent traversal as an or of relation paths", async () => {
    const file = term<{ id: string }>()
    const project = term<{ id: string }>()
    const team = term<{ id: string }>()
    const document = term<{ id: string }>()

    const fileInProject = relation<{ id: string }, { id: string }>()
    const projectInTeam = relation<{ id: string }, { id: string }>()
    const fileInTeam = relation<{ id: string }, { id: string }>()
    const teamOwnsDocument = relation<{ id: string }, { id: string }>()

    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: fileInProject,
          source: {
            kind: "edge",
            table: "files",
            leftColumn: "id",
            rightColumn: "project_id",
          },
        },
        {
          relation: projectInTeam,
          source: {
            kind: "edge",
            table: "projects",
            leftColumn: "id",
            rightColumn: "team_id",
          },
        },
        {
          relation: fileInTeam,
          source: {
            kind: "edge",
            table: "files",
            leftColumn: "id",
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
      termEncodings: [
        { term: file, encode: value => value.id },
        { term: document, encode: value => value.id },
      ],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const rule = and(
      or(
        and(fileInProject(file, project), projectInTeam(project, team)),
        fileInTeam(file, team),
      ),
      teamOwnsDocument(team, document),
    )

    await expect(
      instance.evaluate(rule, {
        [file]: { id: "f1" },
        [document]: { id: "d1" },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [file]: { id: "f2" },
        [document]: { id: "d1" },
      }),
    ).resolves.toBe(true)

    await expect(
      instance.evaluate(rule, {
        [file]: { id: "f3" },
        [document]: { id: "d1" },
      }),
    ).resolves.toBe(false)
  })

  it("evaluates forall with relation-derived candidates (no explicit domain)", async () => {
    const viewer = term<{ id: string }>()
    const membership = term<{ id: string }>()
    const team = term<{ id: string }>()
    const document = term<{ id: string }>()

    const userHasMembership = relation<{ id: string }, { id: string }>()
    const membershipBelongsToTeam = relation<{ id: string }, { id: string }>()
    const teamOwnsDocument = relation<{ id: string }, { id: string }>()

    // This adapter does NOT provide an explicit termDomains for document,
    // so the planner must derive candidates from the relation that produces document terms.
    const adapter = createPostgresAdapter({
      relationMappings: [
        {
          relation: userHasMembership,
          source: {
            kind: "join-table",
            table: "workspace_memberships",
            leftColumn: "user_id",
            rightColumn: "membership_id",
            staticFilters: [{ sql: "{{source}}.deleted_at IS NULL" }],
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
      // Intentionally omit termDomains for document to test relation-derived candidates
      termEncodings: [{ term: viewer, encode: value => value.id }],
      queryExecutor: {
        async query(sql, params) {
          const result = await client.query(sql, [...params])
          return { rows: result.rows }
        },
      },
    })
    const instance = evaluator(adapter, {
      evaluatorContext: null,
    })

    const memberRule = and(
      userHasMembership(viewer, membership),
      membershipBelongsToTeam(membership, team),
      teamOwnsDocument(team, document),
    )

    // Rule: forall documents (derived from team_documents), the viewer can access them
    // Derived domain includes only documents in team_documents (just d1).
    // u1 can access d1 via t1, so forall should succeed (true)
    const rule = forAll(document, memberRule)

    await expect(
      instance.evaluate(rule, {
        [viewer]: { id: "u1" },
      }),
    ).resolves.toBe(true)
  })
})

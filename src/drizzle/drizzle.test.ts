import { pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { attr, exists, planPostgresRule, relation, term } from ".."
import { getTermInfo } from "../core/algebra"
import { attachedTermDomain } from "../core/self-describing"
import { through } from "../rebac"
import {
  associatesTable,
  bindRowVar,
  drizzleExecutor,
  drizzleResourceType,
  edge,
  fromFk,
  idVar,
  inColumn,
  rowVar,
  rowVarDomain,
  rowVarEncoding,
  via,
} from "./index"

describe("drizzle bridge", () => {
  it("derives belongsTo relation sources from FK columns", () => {
    const systems = pgTable("systems", { id: text("id").primaryKey() })
    const branches = pgTable("branches", {
      id: text("id").primaryKey(),
      systemId: text("system_id").references(() => systems.id),
    })

    expect(fromFk(branches.systemId)).toEqual({
      kind: "edge",
      table: "branches",
      leftColumn: "id",
      rightColumn: "system_id",
    })
  })

  it("builds edge relation sources from typed column pairs", () => {
    const branches = pgTable("branches", {
      id: text("id").primaryKey(),
      systemId: text("system_id").notNull(),
      status: text("status").notNull(),
    })

    expect(
      edge(branches.id, branches.systemId, {
        predicates: [inColumn(branches.status, ["active"])],
        staticFilters: [{ sql: "status = $1", params: ["active"] }],
      }),
    ).toEqual({
      kind: "edge",
      table: "branches",
      leftColumn: "id",
      rightColumn: "system_id",
      predicates: [{ column: "status", op: "in", values: ["active"] }],
      staticFilters: [{ sql: "status = $1", params: ["active"] }],
    })
  })

  it("rejects edge relation sources across different tables", () => {
    const systems = pgTable("systems", { id: text("id").primaryKey() })
    const branches = pgTable("branches", {
      id: text("id").primaryKey(),
      systemId: text("system_id").notNull(),
    })

    expect(() => edge(branches.id, systems.id)).toThrow(
      "edge() columns must belong to the same table (got branches, systems)",
    )
  })

  it("builds association-table sources and typed in predicates", () => {
    const teamMembers = pgTable("team_members", {
      userId: text("user_id").notNull(),
      teamId: text("team_id").notNull(),
      role: text("role").$type<"viewer" | "editor" | "owner">().notNull(),
    })

    expect(
      associatesTable(teamMembers, {
        left: teamMembers.userId,
        right: teamMembers.teamId,
        predicates: [inColumn(teamMembers.role, ["editor", "owner"])],
      }),
    ).toEqual({
      kind: "join-table",
      table: "team_members",
      leftColumn: "user_id",
      rightColumn: "team_id",
      predicates: [{ column: "role", op: "in", values: ["editor", "owner"] }],
    })
  })

  it("derives resource metadata from table PK and validates composite bindings", () => {
    const branchTerm = term<string>()
    const teamTerm = term<string>()
    const nodeInTeam = relation<{ id: string; branchId: string }, string>()
    const nodes = pgTable(
      "canvas_nodes",
      {
        id: text("id").notNull(),
        branchId: text("branch_id").notNull(),
      },
      table => [primaryKey({ columns: [table.id, table.branchId] })],
    )

    const NodeResource = drizzleResourceType(nodes, {
      owner: through(nodeInTeam),
      contextTerms: { branchId: branchTerm },
    })

    expect(NodeResource.table).toBe("canvas_nodes")
    expect(NodeResource.key).toBe("id")
    expect(NodeResource.ownedBy(teamTerm)).toBeDefined()

    expect(() =>
      drizzleResourceType(nodes, {
        owner: through(nodeInTeam),
      }),
    ).toThrow(
      "drizzleResourceType(canvas_nodes) requires contextTerms/fixed for composite PK columns: branch_id",
    )
  })

  it("adapts db.$client.query to PostgresQueryExecutor", async () => {
    const executor = drizzleExecutor({
      $client: {
        query: async <Row extends Record<string, unknown>>() => ({
          rows: [{ ok: true }] as unknown as Row[],
        }),
      },
    })

    await expect(executor.query("SELECT 1", [])).resolves.toEqual({
      rows: [{ ok: true }],
    })
  })

  it("creates row variables with typed column accessors and planner metadata", () => {
    const systems = pgTable("systems", { id: text("id").primaryKey() })
    const branches = pgTable("branches", {
      id: text("id").primaryKey(),
      systemId: text("system_id").references(() => systems.id),
    })
    const branch = rowVar(branches)

    expect(branch.$.systemId).toEqual(attr(branch, "systemId"))
    expect(rowVarDomain(branch)).toEqual({
      term: branch,
      table: "branches",
      valueColumn: "id",
      columns: {
        id: "id",
        systemId: "system_id",
      },
    })

    const env = bindRowVar(branch, { id: "branch-1", systemId: "system-1" })
    expect(env[branch]).toBe("branch-1")
    expect(
      rowVarEncoding(branch).encode({ id: "branch-1", systemId: "system-1" }),
    ).toBe("branch-1")
    expect(rowVarEncoding(branch).encode("branch-2" as any)).toBe("branch-2")
  })

  it("requires object inputs when encoding composite-key row variables", () => {
    const nodes = pgTable(
      "canvas_nodes",
      {
        id: text("id").notNull(),
        branchId: text("branch_id").notNull(),
      },
      table => [primaryKey({ columns: [table.id, table.branchId] })],
    )
    const node = rowVar(nodes)

    expect(() => rowVarEncoding(node).encode("node-1" as any)).toThrow(
      "rowVar encoding for composite primary keys requires an object containing the selected key property",
    )
    expect(
      rowVarEncoding(node).encode({ id: "node-1", branchId: "branch-1" }),
    ).toBe("node-1")
  })

  it("supports explicit via(...) wrappers for relation chains", () => {
    const branch = term<{ id: string }>()
    const system = term<{ id: string }>()
    const branchInSystem = relation<{ id: string }, { id: string }>()

    expect(through(via(branchInSystem))(branch, system)).toEqual(
      through(branchInSystem)(branch, system),
    )
  })

  it("idVar mints a pk-typed term with a self-describing domain", () => {
    const teams = pgTable("teams", { id: text("id").primaryKey() })

    const teamT = idVar(teams)
    const root = getTermInfo(teamT).root as symbol

    expect(attachedTermDomain(root)).toMatchObject({
      table: "teams",
      valueColumn: "id",
    })
  })

  it("idVar terms are distinct variables over the same domain", () => {
    const teams = pgTable("teams", { id: text("id").primaryKey() })

    const teamT = idVar(teams)
    const memberTeamT = idVar(teams, "memberTeam")

    expect(teamT).not.toBe(memberTeamT)
    expect(getTermInfo(memberTeamT).root.description).toContain("memberTeam")
  })

  it("idVar requires a primary key", () => {
    const notes = pgTable("notes", { body: text("body") })

    expect(() => idVar(notes)).toThrow("idVar(notes) requires a primary key")
  })

  it("idVar exists() plans with no explicit termDomains", () => {
    const teams = pgTable("teams_idvar_plan", { id: text("id").primaryKey() })
    const teamT = idVar(teams)

    const plan = planPostgresRule(exists(teamT), {
      relationMappings: [],
      environment: { [teamT]: "team-1" },
    })

    expect(plan.sql).toContain('"teams_idvar_plan"')
  })

  it("fromFk(column, target) returns a self-describing relation", () => {
    const systems = pgTable("systems_fkrel", { id: text("id").primaryKey() })
    const branches = pgTable("branches_fkrel", {
      id: text("id").primaryKey(),
      systemId: text("system_id").references(() => systems.id),
    })

    const branchInSystem = fromFk(branches.systemId, systems)
    const branchT = idVar(branches)
    const systemT = idVar(systems)

    const plan = planPostgresRule(branchInSystem(branchT, systemT), {
      relationMappings: [],
      environment: { [branchT]: "branch-1", [systemT]: "sys-1" },
    })

    expect(plan.sql).toContain('"branches_fkrel"')
    expect(plan.sql).toContain('"system_id"')
  })

  it("fromFk(column, target) validates the FK actually references target", () => {
    const systems = pgTable("systems_fkval", { id: text("id").primaryKey() })
    const projects = pgTable("projects_fkval", { id: text("id").primaryKey() })
    const branches = pgTable("branches_fkval", {
      id: text("id").primaryKey(),
      systemId: text("system_id").references(() => systems.id),
    })

    expect(() => fromFk(branches.systemId, projects)).toThrow(
      'fromFk(system_id) references "systems_fkval", not "projects_fkval"',
    )
  })
})

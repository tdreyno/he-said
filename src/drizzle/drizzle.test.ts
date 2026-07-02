import { pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { attr, relation, term } from ".."
import { through } from "../rebac"
import {
  associatesTable,
  bindRowVar,
  drizzleExecutor,
  drizzleResourceType,
  fromFk,
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
})

import { pgTable, text } from "drizzle-orm/pg-core"
import { eq, relation } from ".."
import { through } from "../rebac"
import { rowVar, via } from "./index"

const systems = pgTable("systems", {
  id: text("id").primaryKey(),
  slug: text("slug").$type<"primary" | "secondary">().notNull(),
})

const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  systemId: text("system_id").references(() => systems.id),
})

const branch = rowVar(branches)
const system = rowVar(systems)

eq(branch.$.systemId, system.$.id)
eq(system.$.slug, "primary")

// @ts-expect-error system.slug is not numeric
eq(system.$.slug, 123)

const branchInSystem = relation<
  typeof branches.$inferSelect,
  typeof systems.$inferSelect
>()
through(via(branchInSystem))(branch, system)

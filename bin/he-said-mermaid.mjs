#!/usr/bin/env node
/**
 * he-said-mermaid — emit Mermaid flow charts for rule algebra.
 *
 * Usage:
 *   he-said-mermaid <module> [exportName...]
 *
 * <module> is imported (relative paths resolve from cwd; run under bun/tsx
 * for TypeScript sources). Each named export — or every export when none are
 * named — is rendered when it is a Rule, a Record<name, Rule> (one subgraph
 * per entry), or a Record<name, Record<action, Rule>> (flattened to
 * "name.action" subgraphs). Output goes to stdout as ```mermaid blocks.
 */
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [modulePath, ...exportNames] = process.argv.slice(2)

if (!modulePath) {
  console.error("usage: he-said-mermaid <module> [exportName...]")
  process.exit(1)
}

/**
 * Resolve the mermaid module from the CONSUMER's he-said installation when
 * one exists, so the CLI and the imported rule module share one library
 * instance (two copies would race the Symbol.prototype installs and throw).
 * Falls back to the CLI's own dist for use inside this repo.
 */
const mermaidModule = await (async () => {
  try {
    const requireFromCwd = createRequire(
      pathToFileURL(resolve(process.cwd(), "package.json")),
    )
    const resolved = requireFromCwd.resolve("@tdreyno/he-said/mermaid")
    return await import(pathToFileURL(resolved).href)
  } catch {
    return await import("../dist/mermaid/index.js")
  }
})()

const { isRule, ruleToMermaid, rulesToMermaid } = mermaidModule

const moduleUrl = modulePath.startsWith(".")
  ? pathToFileURL(resolve(process.cwd(), modulePath)).href
  : modulePath

const loaded = await import(moduleUrl)

const flattenRules = value => {
  if (isRule(value)) {
    return { rule: value }
  }
  if (typeof value !== "object" || value === null) {
    return null
  }

  const flat = {}
  for (const [name, entry] of Object.entries(value)) {
    if (isRule(entry)) {
      flat[name] = entry
    } else if (typeof entry === "object" && entry !== null) {
      for (const [action, rule] of Object.entries(entry)) {
        if (isRule(rule)) {
          flat[`${name}.${action}`] = rule
        }
      }
    }
  }
  return Object.keys(flat).length > 0 ? flat : null
}

/** relation/term names from the module's own exports (symbols + relations). */
const nameMaps = () => {
  const relationNames = new Map()
  const termNames = new Map()
  for (const [name, value] of Object.entries(loaded)) {
    if (typeof value === "function" && value.kind === "relation") {
      relationNames.set(value.id, name)
    } else if (typeof value === "symbol") {
      termNames.set(value, name)
    }
  }
  return { relationNames, termNames }
}

const options = nameMaps()
const selected = exportNames.length > 0 ? exportNames : Object.keys(loaded)

let rendered = 0
for (const name of selected) {
  if (!(name in loaded)) {
    console.error(`export "${name}" not found in ${modulePath}`)
    process.exit(1)
  }
  const flat = flattenRules(loaded[name])
  if (!flat) {
    continue
  }

  console.log(`## ${name}\n`)
  console.log("```mermaid")
  console.log(
    "rule" in flat && isRule(flat.rule) && Object.keys(flat).length === 1
      ? ruleToMermaid(flat.rule, options)
      : rulesToMermaid(flat, options),
  )
  console.log("```\n")
  rendered += 1
}

if (rendered === 0) {
  console.error("no rule-shaped exports found")
  process.exit(1)
}

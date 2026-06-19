import { createAbilityInstance } from "./instance"
import {
  AbilityDefinition,
  AbilityInstance,
  AbilityOptions,
  RebacDeps,
} from "./types"

const toArray = <T>(value?: T | Array<T>): Array<T> => {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

const normalizeDefinition = <Context, Deps extends RebacDeps>(
  name: string,
  options?: AbilityOptions<Context, Deps>,
): AbilityDefinition<Context, Deps> => {
  return {
    name,
    description: options?.description,
    where: toArray(options?.where),
    relation: toArray(options?.relation),
    meta: options?.meta,
    strictness: options?.strictness,
  }
}

export const ability = <Context, Deps extends RebacDeps = RebacDeps>(
  name: string,
  options?: AbilityOptions<Context, Deps>,
): AbilityInstance<Context, Deps> => {
  if (!name || !name.trim()) {
    throw new Error("ability name is required")
  }

  const definition = normalizeDefinition(name.trim(), options)

  return createAbilityInstance(name.trim(), definition.description, {
    type: "ability",
    definition,
  })
}

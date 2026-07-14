import type {
  Environment,
  EvaluationInput,
  EvaluatorInstance,
  FilterOptions,
  Rule,
} from "./algebra"

/**
 * Principal pre-binding: wrap an evaluator instance with a base environment
 * (typically the actor and their facts, computed once per request) so every
 * subsequent check supplies only the per-check bindings. Call-site bindings
 * win on conflict; `facts` bags merge the same way.
 *
 * This is the DX seam for "an engine scoped to this principal". Plan-level
 * caching remains the adapter's concern (see `prepare()`); profile before
 * reaching for it — planning is pure string building.
 */
export const bindEnvironment = <Env extends Environment>(
  engine: EvaluatorInstance<Env>,
  base: Readonly<EvaluationInput<Env>> | Readonly<Environment>,
): EvaluatorInstance<Env> => {
  const merge = (
    input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
  ): Readonly<EvaluationInput<Env>> => {
    const baseInput = base as Readonly<EvaluationInput<Env>>
    const callInput = input as Readonly<EvaluationInput<Env>>
    const facts =
      baseInput.facts || callInput.facts
        ? { ...(baseInput.facts ?? {}), ...(callInput.facts ?? {}) }
        : undefined

    return {
      ...baseInput,
      ...callInput,
      ...(facts ? { facts } : {}),
    } as Readonly<EvaluationInput<Env>>
  }

  return {
    evaluate(
      rule: Rule,
      input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
    ) {
      return engine.evaluate(rule, merge(input))
    },
    evaluateWithProof(
      rule: Rule,
      input: Readonly<Env> | Readonly<EvaluationInput<Env>>,
    ) {
      return engine.evaluateWithProof(rule, merge(input))
    },
    filter<T>(rule: Rule, options: FilterOptions<Env, T>) {
      // filter options carry a plain environment (no facts bag slot) —
      // flatten merged facts into direct bindings, which is equivalent.
      const merged = merge(options.environment) as Record<PropertyKey, unknown>
      const { facts, ...bindings } = merged
      const environment = {
        ...bindings,
        ...((facts as Record<PropertyKey, unknown> | undefined) ?? {}),
      } as Env

      return engine.filter(rule, { ...options, environment })
    },
    prepare(options) {
      return engine.prepare(options)
    },
  }
}

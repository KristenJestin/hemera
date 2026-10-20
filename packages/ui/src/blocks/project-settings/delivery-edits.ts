import { presetSteps, pushedIn, wavesOf } from './delivery-fixtures.ts'
import {
  type Dependency,
  type DeliveryRules,
  MOMENTS,
  type Moment,
  type Preset,
  type RecipeStep,
  type StepConfig,
} from './delivery-model.ts'

/** What the page does to the rules a story holds, as the engine would answer it. */

/** A repository changed to a preset: its recipe is the preset's again. */
export function withPreset(rules: DeliveryRules, path: string, preset: Preset): DeliveryRules {
  return {
    ...rules,
    repositories: rules.repositories.map((one) =>
      one.path === path
        ? {
            ...one,
            preset,
            steps: presetSteps(preset, `@acme/${path}`),
          }
        : one,
    ),
  }
}

/** A step left out put back: it is the preset's again. */
export function withPutBack(rules: DeliveryRules, path: string, id: string): DeliveryRules {
  return {
    ...rules,
    repositories: rules.repositories.map((one) =>
      one.path === path
        ? {
            ...one,
            steps: one.steps.map((s) =>
              s.step.id === id ? { step: s.step, origin: 'preset', moment: s.moment } : s,
            ),
          }
        : one,
    ),
  }
}

/** The push and the pull requests moved, in every repository, where Push and open says. */
export function withPushIn(rules: DeliveryRules, placement: 'review' | 'waves'): DeliveryRules {
  return { ...rules, repositories: pushedIn(rules.repositories, placement) }
}

/** A proposed dependency accepted: the waves follow it. */
export function withAccepted(rules: DeliveryRules, dependency: Dependency): DeliveryRules {
  const dependencies = rules.dependencies.map((one) =>
    one === dependency ? { ...one, proposed: false } : one,
  )
  return {
    ...rules,
    dependencies,
    waves:
      wavesOf(
        rules.repositories.map((one) => one.path),
        dependencies,
      ) ?? [],
  }
}

/** A cleanup step removed. */
export function withoutCleanup(rules: DeliveryRules, id: string): DeliveryRules {
  return { ...rules, cleanup: rules.cleanup.filter((one) => one.id !== id) }
}

/** A cleanup step added, after the others. */
export function withCleanup(
  rules: DeliveryRules,
  config: StepConfig,
  label: string,
): DeliveryRules {
  return {
    ...rules,
    cleanup: [...rules.cleanup, { id: `added-${String(rules.cleanup.length + 1)}`, label, config }],
  }
}

/**
 * A placed step moved in its repository's recipe: taken out, then put back in `moment` after
 * `after` (null: first there, undefined: last). A preset's step moved reads as changed here.
 */
export function withStepPlaced(
  rules: DeliveryRules,
  path: string,
  id: string,
  moment: Moment,
  after: string | null | undefined,
): DeliveryRules {
  return {
    ...rules,
    repositories: rules.repositories.map((repository) => {
      if (repository.path !== path) return repository
      const one = repository.steps.find((s) => s.step.id === id)
      if (one === undefined) return repository
      const rest = repository.steps.filter((s) => s.step.id !== id)
      const moved: RecipeStep = {
        ...one,
        moment,
        origin: one.origin === 'preset' ? 'changed' : one.origin,
      }
      const rank = MOMENTS.indexOf(moment)
      const firstAfter = rest.findIndex((s) => MOMENTS.indexOf(s.moment) > rank)
      const end = firstAfter === -1 ? rest.length : firstAfter
      const start = rest.findIndex((s) => MOMENTS.indexOf(s.moment) >= rank)
      const at =
        after === undefined
          ? end
          : after === null
            ? start === -1
              ? rest.length
              : start
            : rest.findIndex((s) => s.step.id === after) + 1
      return { ...repository, steps: [...rest.slice(0, at), moved, ...rest.slice(at)] }
    }),
  }
}

/**
 * An accepted dependency removed: the waves follow; one the manifests still name is proposed
 * again, as the engine proposes it at its next reading.
 */
export function withDependencyRemoved(
  rules: DeliveryRules,
  dependency: Dependency,
  manifests: readonly Dependency[],
): DeliveryRules {
  const same = (one: Dependency) =>
    one.repository === dependency.repository && one.on === dependency.on
  const read = manifests.some(same)
  const dependencies = rules.dependencies.flatMap((one) =>
    same(one) ? (read ? [{ ...one, proposed: true }] : []) : [one],
  )
  return {
    ...rules,
    dependencies,
    waves:
      wavesOf(
        rules.repositories.map((one) => one.path),
        dependencies,
      ) ?? [],
  }
}

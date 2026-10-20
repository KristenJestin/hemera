import { presetSteps, pushedIn, wavesOf } from './delivery-fixtures.ts'
import type { Dependency, DeliveryRules, Preset, StepConfig } from './delivery-model.ts'

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

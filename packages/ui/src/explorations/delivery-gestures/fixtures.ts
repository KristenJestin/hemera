import { CLEANUP, RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import type { Dependency, DeliveryRules } from '../../blocks/project-settings/delivery-model.ts'
import { templateRefusal } from '../../blocks/project-settings/delivery-words.ts'
import type { PlacedRefusals } from './refusals.tsx'

/** The cases the gestures of the delivery rules are drawn on: Acme, with api, web and shared. */

const MISTYPED = '{key}: {titel}'

/** A commit template with a name Hemera does not fill, and a cleanup step after the Workspace is gone. */
export const REFUSED_RULES: DeliveryRules = {
  ...RULES,
  pullRequests: { ...RULES.pullRequests, commit: MISTYPED },
  cleanup: [
    ...CLEANUP,
    {
      id: 'notify',
      label: 'Notify the release',
      config: { kind: 'command', command: 'notify-release' },
    },
  ],
}

export const REFUSALS: PlacedRefusals = {
  template: { kind: 'commit', words: templateRefusal(MISTYPED) ?? '' },
  cleanup: {
    id: 'notify',
    words:
      'Cleanup runs “Notify the release” after removing the Workspace, but nothing runs once it is gone.',
  },
}

/** What Hemera reads in Acme's manifests: api and web use shared, web uses api. */
export const MANIFESTS: readonly Dependency[] = [
  { repository: 'api', on: 'shared', proposed: true },
  { repository: 'web', on: 'shared', proposed: true },
  { repository: 'web', on: 'api', proposed: true },
]

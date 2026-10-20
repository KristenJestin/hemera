import { CLEANUP, RULES, presetSteps } from '../../blocks/project-settings/delivery-fixtures.ts'
import type { DeliveryRules } from '../../blocks/project-settings/delivery-model.ts'

/**
 * The cases the open questions of the delivery rules are drawn on: Hemera's own delivery
 * (question 47) and a Project with no forge (question 80).
 */

/**
 * Hemera delivered by its own rules: one repository, its pull requests into `dev`, squashed, so
 * the title of each is the subject semantic-release reads; the CI after the merge publishes a
 * prerelease, found by its tag. Promoting `dev` to `main` is a release, not a mission's delivery.
 */
export const HEMERA_RULES: DeliveryRules = {
  pullRequests: {
    ...RULES.pullRequests,
    commit: '{title}',
    title: '{title}',
    body: '{summary}\n\n{images}\n\nCloses {key}',
    reviewers: [],
    requireApproval: false,
  },
  repositories: [
    {
      path: 'hemera',
      preset: 'application',
      remote: 'origin',
      remotes: ['origin'],
      base: 'dev',
      forge: { kind: 'github', host: 'github.com', forced: false, cli: 'ready' },
      steps: [
        ...presetSteps('application'),
        {
          step: {
            id: 'published',
            start: 'auto',
            config: { kind: 'published', by: 'tag', pattern: 'v*-beta.*' },
          },
          origin: 'added',
          moment: 'waves',
        },
      ],
    },
  ],
  dependencies: [],
  waves: [['hemera']],
  cleanup: CLEANUP,
}

const LOCAL_REPOSITORY = {
  path: 'shared',
  preset: 'local',
  remote: 'origin',
  remotes: [],
  base: 'main',
  forge: { kind: 'none', host: '', forced: false, cli: 'ready' },
} as const

/** Question 80, recommended: the Local preset merges the branch into `main` on this machine. */
export const LOCAL_MERGE_RULES: DeliveryRules = {
  ...RULES,
  pullRequests: { ...RULES.pullRequests, reviewers: [], requireApproval: false },
  repositories: [
    {
      ...LOCAL_REPOSITORY,
      steps: presetSteps('local'),
    },
  ],
  dependencies: [],
  waves: [['shared']],
}

/**
 * Question 80, the alternative: Ship only records the delivery, and the merge into `main` is the
 * first step of the cleanup.
 */
export const LOCAL_CLEANUP_RULES: DeliveryRules = {
  ...LOCAL_MERGE_RULES,
  repositories: [{ ...LOCAL_REPOSITORY, steps: [] }],
  cleanup: [{ id: 'local-merge', label: 'Merge the branch into main on this machine' }, ...CLEANUP],
}

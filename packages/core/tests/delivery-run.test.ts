/**
 * The delivery run as pure rules (S1): which repositories take part, in which wave each leaves, and
 * how the steps' states add up to a repository's status and the delivery's.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { DeliveryAction, WavesCopy } from '../src/domain/delivery.ts'
import {
  type PlannedRepository,
  type StepStanding,
  deliveryStatus,
  planDelivery,
  repositoryStatus,
  stepSaid,
} from '../src/domain/delivery-run.ts'

const MERGE: DeliveryAction = { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }
const CI: DeliveryAction = { id: 'ci', kind: 'ci', mode: 'auto' }
const BUMP: DeliveryAction = { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } }
const PUBLISHED: DeliveryAction = {
  id: 'published-version',
  kind: 'published-version',
  mode: 'auto',
  detect: { by: 'registry', packageName: null },
}

const library = (id: string, deliversAfter: ReadonlyArray<string> = []) => ({
  repositoryId: id,
  name: id,
  preset: 'library' as const,
  steps: deliversAfter.length === 0 ? [MERGE, CI, PUBLISHED] : [BUMP, MERGE, CI, PUBLISHED],
  deliversAfter: [...deliversAfter],
})

const application = (id: string, deliversAfter: ReadonlyArray<string> = []) => ({
  repositoryId: id,
  name: id,
  preset: 'application' as const,
  steps: deliversAfter.length === 0 ? [MERGE, CI] : [BUMP, MERGE, CI],
  deliversAfter: [...deliversAfter],
})

const wavesOf = (repositories: WavesCopy['repositories']): WavesCopy => ({
  section: 'waves',
  version: 3,
  copiedAt: '2026-10-21T08:00:00.000Z',
  repositories,
})

/** The issue's example: `shared`, `lib-a` and `lib-b` over it, `api` and `web` over the libraries. */
const EXAMPLE = wavesOf([
  library('shared'),
  library('lib-a', ['shared']),
  library('lib-b', ['shared']),
  application('api', ['lib-a', 'lib-b']),
  application('web', ['lib-a', 'lib-b']),
])

const shape = (repositories: ReadonlyArray<PlannedRepository>) =>
  repositories.map((one) => [one.repositoryId, one.wave, one.bumpOnly])

describe('which repositories take part', () => {
  test('participation: a changed repository takes part, an unchanged one is skipped', () => {
    const plan = planDelivery(wavesOf([application('api'), application('web')]), ['api'])
    expect(shape(plan.repositories)).toEqual([['api', 0, false]])
  })

  test('participation: the dependants of a publishing repository take part as bump only, transitively', () => {
    const plan = planDelivery(EXAMPLE, ['shared', 'api', 'web'])
    expect(shape(plan.repositories)).toEqual([
      ['shared', 0, false],
      ['lib-a', 1, true],
      ['lib-b', 1, true],
      ['api', 2, false],
      ['web', 2, false],
    ])
  })

  test('participation: a dependant of a repository that publishes nothing is skipped', () => {
    const plan = planDelivery(wavesOf([application('core'), application('api', ['core'])]), [
      'core',
    ])
    expect(shape(plan.repositories)).toEqual([['core', 0, false]])
  })

  test('participation: a bump-only repository that publishes brings its own dependants in', () => {
    const plan = planDelivery(EXAMPLE, ['shared'])
    expect(shape(plan.repositories)).toEqual([
      ['shared', 0, false],
      ['lib-a', 1, true],
      ['lib-b', 1, true],
      ['api', 2, true],
      ['web', 2, true],
    ])
  })

  test('participation: a changed repository nobody depends on leaves in the first wave', () => {
    const plan = planDelivery(EXAMPLE, ['web'])
    expect(shape(plan.repositories)).toEqual([['web', 0, false]])
  })

  test('each repository keeps its steps in their order, ids unchanged', () => {
    const plan = planDelivery(EXAMPLE, ['shared'])
    expect(plan.repositories[0]?.steps.map((step) => step.id)).toEqual([
      'merge',
      'ci',
      'published-version',
    ])
    expect(plan.repositories.map((one) => one.name)).toEqual([
      'shared',
      'lib-a',
      'lib-b',
      'api',
      'web',
    ])
  })
})

describe('waves follow the dependency order', () => {
  test('a repository leaves after the wave of every participating repository it depends on', () => {
    const plan = planDelivery(
      wavesOf([
        library('a'),
        library('b', ['a']),
        application('c', ['b']),
        application('d', ['a']),
      ]),
      ['a', 'c', 'd'],
    )
    expect(shape(plan.repositories)).toEqual([
      ['a', 0, false],
      ['b', 1, true],
      ['d', 1, false],
      ['c', 2, false],
    ])
  })

  test('a dependency that does not take part sets no wave', () => {
    const plan = planDelivery(EXAMPLE, ['api'])
    expect(shape(plan.repositories)).toEqual([['api', 0, false]])
  })
})

const steps = (...states: ReadonlyArray<StepStanding['state']>): StepStanding[] =>
  states.map((state) => ({ state }))

describe('a repository’s status, from its steps', () => {
  test('delivered once its last step is done (CT-51)', () => {
    expect(repositoryStatus(steps('done', 'done', 'done'))).toBe('delivered')
  })

  test('not started while every step is pending', () => {
    expect(repositoryStatus(steps('pending', 'pending'))).toBe('not-started')
  })

  test('failed, stopped, waiting, needs you and running, as the first step not done stands', () => {
    expect(repositoryStatus(steps('done', 'failed', 'pending'))).toBe('failed')
    expect(repositoryStatus(steps('done', 'stopped', 'stopped'))).toBe('stopped')
    expect(repositoryStatus(steps('done', 'waiting'))).toBe('waiting')
    expect(repositoryStatus(steps('done', 'needs-click'))).toBe('needs-you')
    expect(repositoryStatus(steps('indeterminate', 'pending'))).toBe('needs-you')
    expect(repositoryStatus(steps('done', 'running'))).toBe('running')
    expect(repositoryStatus(steps('done', 'pending'))).toBe('running')
  })
})

describe('the delivery’s status', () => {
  test('delivered when every participating repository is', () => {
    expect(deliveryStatus({ stopped: false, repositories: ['delivered', 'delivered'] })).toBe(
      'delivered',
    )
  })

  test('partially delivered when stopped or failed with a repository delivered', () => {
    expect(deliveryStatus({ stopped: true, repositories: ['delivered', 'stopped'] })).toBe(
      'partially-delivered',
    )
    expect(deliveryStatus({ stopped: false, repositories: ['delivered', 'failed'] })).toBe(
      'partially-delivered',
    )
  })

  test('stopped with nothing delivered, running otherwise', () => {
    expect(deliveryStatus({ stopped: true, repositories: ['stopped', 'not-started'] })).toBe(
      'stopped',
    )
    expect(deliveryStatus({ stopped: false, repositories: ['waiting', 'not-started'] })).toBe(
      'running',
    )
  })
})

describe('what a click step says it will do', () => {
  test('a step is said with what it does and where', () => {
    expect(
      stepSaid({ id: 'deploy', kind: 'command', mode: 'click', commandId: 'deploy' }, 'web'),
    ).toBe('Run deploy in web')
    expect(stepSaid(MERGE, 'api')).toBe('Merge squash in api')
  })
})

/**
 * What the exclusive resources show of the engine's records, and what their dialog writes back:
 * a line per resource with its holder and its queue, a draft read from a declaration, the whole
 * list the engine takes at save, and the words of a refusal.
 */

import {
  type Command,
  type ExclusiveResource,
  InvalidResources,
  type ResourceHolding,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  draftOf,
  holdingOf,
  resourceDraftsOf,
  resourceRefusal,
  resourceViewsOf,
  savedWords,
  sinceWords,
  withoutResource,
} from '../src/renderer/resources-model.ts'

const command = (id: string, name: string): Command => ({
  id,
  projectId: 'acme',
  name,
  type: 'run',
  line: `run ${id}`,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
})

const CATALOGUE = [
  command('migrate', 'Migrate the database'),
  command('seed', 'Seed the database'),
  command('reset', 'Reset the database'),
  command('stripe', 'Replay payment webhooks'),
]

const DB: ExclusiveResource = {
  id: 'db',
  projectId: 'acme',
  name: 'Shared database',
  description: 'The Postgres of the staging machine.',
  uses: ['migrate', 'seed'],
  changes: ['reset', 'stripe'],
  resetCommandId: 'reset',
}

const SANDBOX: ExclusiveResource = {
  id: 'sandbox',
  projectId: 'acme',
  name: 'Payment sandbox',
  description: '',
  uses: ['stripe'],
  changes: [],
  resetCommandId: null,
}

const NOW = new Date(2026, 9, 9, 12, 0)
const at = (hour: number, minute: number, day = 9): string =>
  new Date(2026, 9, day, hour, minute).toISOString()

const HELD: ResourceHolding = {
  key: 'shared database',
  names: ['shared database'],
  holder: {
    missionId: 'm12',
    missionKey: 'ACME-12',
    projectId: 'acme',
    since: at(9, 41),
    readiness: 'ready',
  },
  queue: [{ missionId: 'm14', missionKey: 'ACME-14', projectId: 'acme', since: at(10, 0) }],
}

describe('the line of a resource', () => {
  test('names its commands and its restore, and who holds it and who waits', () => {
    const views = resourceViewsOf([DB, SANDBOX], [HELD], CATALOGUE, NOW)
    expect(views?.[0]).toEqual({
      id: 'db',
      name: 'Shared database',
      description: 'The Postgres of the staging machine.',
      uses: ['Migrate the database', 'Seed the database'],
      restore: 'Reset the database',
      holder: { missionKey: 'ACME-12', since: '09:41' },
      queue: ['ACME-14'],
    })
    expect(views?.[1]).toMatchObject({ restore: null, holder: null, queue: [] })
  })

  test('is not drawn while the list is on its way', () => {
    expect(resourceViewsOf(null, [], CATALOGUE, NOW)).toBeNull()
  })

  test('keeps the id of a command the catalogue no longer holds', () => {
    const views = resourceViewsOf([{ ...DB, uses: ['gone'] }], [], CATALOGUE, NOW)
    expect(views?.[0]?.uses).toEqual(['gone'])
  })

  test('says the day of a holding that began before today', () => {
    const held = { ...HELD, holder: HELD.holder && { ...HELD.holder, since: at(9, 41, 7) } }
    expect(sinceWords(held.holder.since, NOW)).not.toBe('09:41')
    expect(sinceWords(at(9, 41), NOW)).toBe('09:41')
  })
})

describe('the holding of a resource', () => {
  test('is found by its name, trimmed and case-folded', () => {
    expect(holdingOf({ ...DB, name: '  SHARED Database ' }, [HELD])).toBe(HELD)
  })

  test('is found among the names a holding is declared under', () => {
    const shared = { ...HELD, names: ['db of acme', 'shared database'] }
    expect(holdingOf(DB, [shared])).toBe(shared)
  })

  test('is absent for a resource nobody uses', () => {
    expect(holdingOf(SANDBOX, [HELD])).toBeUndefined()
  })
})

describe('a resource in its dialog', () => {
  test('is read from its declaration', () => {
    expect(draftOf(DB)).toEqual({
      name: 'Shared database',
      description: 'The Postgres of the staging machine.',
      uses: ['migrate', 'seed'],
      resetCommandId: 'reset',
    })
  })

  test('starts empty for a new one', () => {
    expect(draftOf(undefined)).toEqual({
      name: '',
      description: '',
      uses: [],
      resetCommandId: null,
    })
  })

  test('is refused without a name, without a command, or with a restore that also uses it', () => {
    const draft = draftOf(DB)
    expect(resourceRefusal({ ...draft, name: '  ' })).toBe('Give the resource a name.')
    expect(resourceRefusal({ ...draft, uses: [] })).toBe(
      'Pick at least one command that uses it.',
    )
    expect(resourceRefusal({ ...draft, resetCommandId: 'seed' })).toBe(
      'The restore command cannot also be one that uses the resource.',
    )
    expect(resourceRefusal(draft)).toBeUndefined()
  })
})

describe('the list the engine takes at save', () => {
  test('replaces the edited resource and keeps the others as declared', () => {
    const saved = resourceDraftsOf([DB, SANDBOX], 'sandbox', {
      name: ' Sandbox ',
      description: 'x',
      uses: ['stripe', 'seed'],
      resetCommandId: null,
    })
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual({
      name: 'Shared database',
      description: 'The Postgres of the staging machine.',
      uses: ['migrate', 'seed'],
      changes: ['reset', 'stripe'],
      resetCommandId: 'reset',
    })
    expect(saved[1]).toEqual({
      name: 'Sandbox',
      description: 'x',
      uses: ['stripe', 'seed'],
      changes: [],
      resetCommandId: null,
    })
  })

  test('keeps the changes of a resource and adds the chosen restore to them', () => {
    const saved = resourceDraftsOf([DB], 'db', { ...draftOf(DB), resetCommandId: 'migrate', uses: ['seed'] })
    expect(saved[0]?.changes).toEqual(['reset', 'stripe', 'migrate'])
  })

  test('drops from the changes a command now chosen as using the resource', () => {
    const saved = resourceDraftsOf([DB], 'db', { ...draftOf(DB), uses: ['migrate', 'stripe'] })
    expect(saved[0]?.changes).toEqual(['reset'])
  })

  test('appends a new resource', () => {
    const saved = resourceDraftsOf([DB], null, { ...draftOf(undefined), name: 'Cache', uses: ['seed'] })
    expect(saved.map((one) => one.name)).toEqual(['Shared database', 'Cache'])
    expect(saved[1]?.changes).toEqual([])
  })

  test('leaves a resource out when it is removed', () => {
    expect(withoutResource([DB, SANDBOX], 'db').map((one) => one.name)).toEqual([
      'Payment sandbox',
    ])
  })
})

describe('the words of a refusal', () => {
  test('are the engine\'s own for a declaration it refuses', () => {
    expect(savedWords(new InvalidResources({ reason: 'Cache is declared twice' }))).toBe(
      'These resources are refused: Cache is declared twice.',
    )
  })

  test('say the resources could not be saved otherwise', () => {
    expect(savedWords(new Error('gone'))).toBe('The resources could not be saved: gone')
  })
})

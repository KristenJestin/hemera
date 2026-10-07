/** What the app settings' sections show, read from the engine's answers (#50). */

import {
  NotQualified,
  Qualified,
  type AgentState,
  type HemeraAutoStatus,
  type NotificationSettings,
  type PermissionDecision,
  type RoleModels,
} from '@hemera/ipc'
import type { RowErrors } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import {
  agentRowsOf,
  appRolesOf,
  backupsSaid,
  decisionsOf,
  jevKeyOf,
  judgeSaid,
  keyWritten,
  notificationsOf,
  reading,
  restoreChosen,
  writing,
  type Read,
} from '../src/renderer/app-settings-data.ts'

const agent = (more: Partial<AgentState>): AgentState => ({
  id: 'claude',
  label: 'Claude Code',
  installed: true,
  version: '2.1.280',
  signedIn: true,
  installer: 'npm',
  qualification: Qualified.make({}),
  installHint: 'npm install -g @anthropic-ai/claude-code',
  loginHint: 'claude /login',
  latest: null,
  ...more,
})

describe('The Agents section', () => {
  test('an installed agent: its version, signed in or the line to sign in, its update and why bare is refused', () => {
    const rows = agentRowsOf([
      agent({}),
      agent({
        id: 'codex',
        label: 'Codex',
        signedIn: false,
        installer: 'unknown',
        latest: '0.50.0',
        version: '0.49.0',
        loginHint: 'codex login',
        qualification: NotQualified.make({ reason: 'its sandbox needs a namespace here' }),
      }),
      agent({
        id: 'opencode',
        label: 'OpenCode',
        installed: false,
        version: null,
        installHint: 'npm i -g opencode-ai',
      }),
    ])
    expect(rows).toEqual([
      {
        name: 'Claude Code',
        state: {
          installed: true,
          version: '2.1.280',
          signedIn: true,
          signIn: 'claude /login',
          installer: 'npm',
          update: undefined,
          bareRefused: undefined,
        },
      },
      {
        name: 'Codex',
        state: {
          installed: true,
          version: '0.49.0',
          signedIn: false,
          signIn: 'codex login',
          installer: undefined,
          update: '0.50.0',
          bareRefused: 'its sandbox needs a namespace here',
        },
      },
      { name: 'OpenCode', state: { installed: false, install: 'npm i -g opencode-ai' } },
    ])
  })
})

describe('Hemera Auto', () => {
  test('the key’s state as the section words it', () => {
    expect(jevKeyOf('missing')).toBe('missing')
    expect(jevKeyOf('saved')).toBe('saved')
    expect(jevKeyOf('invalid')).toBe('invalid')
    expect(jevKeyOf('storage-unavailable')).toBe('unavailable')
  })
})

describe('Notifications & sounds', () => {
  test('one switch per kind and per sound, and the styles', () => {
    const settings: NotificationSettings = {
      kinds: [
        {
          id: 'need',
          label: 'A need waits for you',
          on: true,
          byDefault: true,
          sound: 'needs-you',
        },
      ],
      sounds: [{ sound: 'needs-you', label: 'Something needs you', on: false }],
      style: 'soft',
      styles: [{ style: 'soft', label: 'Soft' }],
    }
    expect(notificationsOf(settings)).toEqual({
      events: [{ id: 'need', label: 'A need waits for you', on: true }],
      sounds: [{ id: 'needs-you', label: 'Something needs you', on: false }],
      style: 'soft',
      styles: [{ id: 'soft', label: 'Soft' }],
    })
  })
})

describe('Profile', () => {
  test('the automatic backups, said in words', () => {
    expect(backupsSaid({ count: 0, latest: null })).toBe('None yet')
    expect(backupsSaid({ count: 12, latest: '2026-10-06T06:12:00.000Z' }, 'UTC')).toBe(
      '12, the last at 06:12',
    )
  })
})

describe('Developer', () => {
  const decision = (sequence: number, more: Partial<PermissionDecision>): PermissionDecision => ({
    sequence,
    occurredAt: '2026-10-06T16:32:08.000Z',
    ownerKind: 'mission',
    ownerId: 'm1',
    tool: 'commands_run',
    target: 'pnpm test',
    verdict: 'allow',
    by: 'hemera',
    policyVersion: 1,
    level: 'standard',
    ...more,
  })

  test('Hemera Auto’s decisions only, the newest first, as the call in short and what came of it', () => {
    expect(
      decisionsOf(
        [
          decision(1, { settled: 'jev', verdict: 'allow' }),
          decision(2, { settled: 'rules' }),
          decision(3, { settled: 'jev', verdict: 'ask', target: 'git push' }),
        ],
        'UTC',
      ),
    ).toEqual([
      { id: '3', call: 'commands_run · git push', verdict: 'asked', when: '16:32' },
      { id: '1', call: 'commands_run · pnpm test', verdict: 'ran', when: '16:32' },
    ])
  })
})

describe('Restore', () => {
  test('restores the backup folder chosen; nothing when none is chosen', async () => {
    const restored: string[] = []
    const restore = async (folder: string) => {
      restored.push(folder)
    }
    await restoreChosen(async () => '/backups/hemera-2026-10-06', restore)
    await restoreChosen(async () => null, restore)
    expect(restored).toEqual(['/backups/hemera-2026-10-06'])
  })

  test('a restore the engine refuses answers its sentence', async () => {
    const said = await restoreChosen(
      async () => '/backups/empty',
      () => Promise.reject(new Error('This folder holds no backup of Hemera.')),
    )
    expect(said).toBe('This folder holds no backup of Hemera.')
  })
})

/** Lets the promises settled so far run their reactions. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('A section read from the engine', () => {
  test('on its way, then what the engine answered', async () => {
    const states: Array<Read<number>> = []
    reading(Promise.resolve(12), (state) => states.push(state))
    await settled()
    expect(states).toEqual([{ kind: 'loading' }, { kind: 'ready', value: 12 }])
  })

  test('a read the engine refuses is said in its words, never left on its way', async () => {
    const states: Array<Read<number>> = []
    reading(Promise.reject(new Error('Hemera could not read its profile.')), (state) =>
      states.push(state),
    )
    await settled()
    expect(states.at(-1)).toEqual({
      kind: 'failed',
      sentence: 'Hemera could not read its profile.',
    })
  })

  test('a read stopped (the section left) says nothing more', async () => {
    const states: Array<Read<number>> = []
    const stop = reading(Promise.resolve(12), (state) => states.push(state))
    stop()
    await settled()
    expect(states).toEqual([{ kind: 'loading' }])
  })
})

describe('A setting written from its row', () => {
  test('a write the engine refuses is said on its row, in words', async () => {
    let errors: RowErrors = {}
    writing(
      Promise.reject(new Error('Hemera could not write to its profile.')),
      'tester',
      'The tester mode could not be changed',
      (change) => {
        errors = change(errors)
      },
    )
    await settled()
    expect(errors).toEqual({
      tester: 'The tester mode could not be changed: Hemera could not write to its profile.',
    })
  })

  test('the row written again: its refusal goes, and what the engine answered is taken', async () => {
    let errors: RowErrors = { tester: 'The tester mode could not be changed: no profile.' }
    const taken: boolean[] = []
    writing(
      Promise.resolve(true),
      'tester',
      'The tester mode could not be changed',
      (change) => {
        errors = change(errors)
      },
      (value) => taken.push(value),
    )
    await settled()
    expect(errors).toEqual({})
    expect(taken).toEqual([true])
  })
})

describe('The Jev key in Hemera Auto', () => {
  const STATUS: HemeraAutoStatus = {
    key: 'saved',
    consent: true,
    judge: 'Jev',
    missing: null,
  }

  test('who judges now, in the settings’ words', () => {
    expect(judgeSaid('Jev')).toBe('Hemera Auto (Jev)')
    expect(judgeSaid('Hemera asks')).toBe('Hemera asks')
  })

  test('a key saved: the status the engine answered', async () => {
    expect(await keyWritten(Promise.resolve(STATUS), 'saved')).toEqual({
      kind: 'done',
      status: STATUS,
    })
  })

  test('a key the system cannot protect is not stored, and says why', async () => {
    const unprotected: HemeraAutoStatus = {
      ...STATUS,
      key: 'storage-unavailable',
      judge: 'Hemera asks',
      missing: 'No Secret Service is running.',
    }
    expect(await keyWritten(Promise.resolve(unprotected), 'saved')).toEqual({
      kind: 'refused',
      sentence: 'The key could not be stored: No Secret Service is running.',
      status: unprotected,
    })
  })

  test('a key removed: the status the engine answered', async () => {
    const removed: HemeraAutoStatus = { ...STATUS, key: 'missing', judge: 'Hemera asks' }
    expect(await keyWritten(Promise.resolve(removed), 'missing')).toEqual({
      kind: 'done',
      status: removed,
    })
  })

  test('a write the engine refuses: said in words', async () => {
    expect(
      await keyWritten(
        Promise.reject(new Error('Hemera could not write to its profile.')),
        'saved',
      ),
    ).toEqual({
      kind: 'refused',
      sentence: 'The key could not be stored: Hemera could not write to its profile.',
      status: null,
    })
    expect(
      await keyWritten(
        Promise.reject(new Error('Hemera could not write to its profile.')),
        'missing',
      ),
    ).toEqual({
      kind: 'refused',
      sentence: 'The key could not be removed: Hemera could not write to its profile.',
      status: null,
    })
  })
})

describe('Models by role, at the application’s level', () => {
  const role = (more: Partial<RoleModels>): RoleModels => ({
    role: 'builder',
    displayName: 'the Builder',
    app: null,
    project: null,
    mission: null,
    resolved: { agent: 'claude', model: 'sonnet', effort: null, level: 'app' },
    ...more,
  })

  test('a role on the default shows no model; one the application chose shows it', () => {
    expect(
      appRolesOf([
        role({}),
        role({
          role: 'planner',
          displayName: 'the Planner',
          app: { agent: 'claude', model: 'opus', effort: 'high' },
          resolved: { agent: 'claude', model: 'opus', effort: 'high', level: 'app' },
        }),
      ]),
    ).toEqual([
      { role: 'the Builder', model: null },
      { role: 'the Planner', model: { agent: 'claude', model: 'opus', effort: 'high' } },
    ])
  })
})

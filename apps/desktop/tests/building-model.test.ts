/**
 * The Ready and Building pages as the window feeds them: the engine's read models of the check,
 * the launch, the Building, its tasks, its services and the mission's own things, in the words the
 * pages use.
 */

import { MaskedText, type DependencyState } from '@hemera/core/domain'
import { HemeraAuthor, NotFetchedSince, UserAuthor } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  budgetOf,
  buildingMomentOf,
  launchCheckOf,
  missionThingsOf,
  percentOf,
  readyMomentOf,
  taskDetailOf,
  type BuildingRead,
  type MissionRead,
  type ReadyRead,
} from '../src/renderer/building-model.ts'
import {
  AGENTS,
  NOW,
  at,
  attempt,
  budget,
  building,
  check,
  command,
  diff,
  grant,
  helper,
  line,
  model,
  now,
  preparation,
  proof,
  review,
  service,
  spec,
  task,
} from './building-fixtures.ts'

const things = (more: Partial<MissionRead> = {}): MissionRead => ({
  dependencies: { dependsOn: [], dependedOnBy: [] },
  titles: new Map([['ACME-9', 'Customer time zones in the api']]),
  grants: [],
  budget: null,
  ...more,
})

const ready = (more: Partial<ReadyRead> = {}): ReadyRead => ({
  spec: spec(),
  frozenAt: at(17, 2, 1),
  check: null,
  checking: false,
  expired: false,
  preparation: null,
  model: null,
  agents: AGENTS,
  marks: [],
  things: things(),
  ...more,
})

const reading = (more: Partial<BuildingRead> = {}): BuildingRead => ({
  building: building(),
  spec: spec({ stage: 'building' }),
  now: now(),
  journal: [],
  journalMore: false,
  services: [],
  catalogue: [],
  helpers: [],
  review: null,
  diff: null,
  workspace: 'acme-12',
  things: things(),
  ...more,
})

const dependency = (
  key: string,
  stage: 'done' | 'building',
  state: DependencyState = 'accepted',
) => ({
  id: `d-${key}`,
  missionId: 'm12',
  missionKey: 'ACME-12',
  dependsOnId: `m-${key}`,
  dependsOnKey: key,
  dependsOnStage: stage,
  reason: 'Its read rules',
  state,
  proposedAt: at(9, 0, 3),
  decidedAt: at(9, 5, 3),
})

describe('The Ready page in its own words', () => {
  test('the frozen Spec in summary: its why, its live requirements and how many scenarios each', () => {
    const moment = readyMomentOf(ready(), NOW)
    expect(moment.goal).toBe('Customers ask for their invoices in a spreadsheet.')
    expect(moment.requirements).toEqual([
      { id: 'R1', title: 'Export the invoices of the current filters as CSV', scenarios: 2 },
      { id: 'R2', title: 'Name the file after the filters', scenarios: 1 },
    ])
    expect(moment.frozenAt).toBe('yesterday at 17:02')
  })

  test('the dependencies with their stage; one not Done keeps the launch', () => {
    const moment = readyMomentOf(
      ready({
        things: things({
          dependencies: {
            dependsOn: [dependency('ACME-9', 'done'), dependency('ACME-10', 'building')],
            dependedOnBy: [],
          },
        }),
      }),
      NOW,
    )
    expect(moment.mission.dependencies).toEqual([
      { key: 'ACME-9', title: 'Customer time zones in the api', stage: 'Done' },
      { key: 'ACME-10', title: 'ACME-10', stage: 'Building' },
    ])
  })

  test('a dependency only proposed or rejected is not one', () => {
    const moment = missionThingsOf(
      things({
        dependencies: {
          dependsOn: [dependency('ACME-10', 'building', 'proposed')],
          dependedOnBy: [],
        },
      }),
      NOW,
    )
    expect(moment.dependencies).toEqual([])
  })

  test('the model the Planner recommends with its reason; the default is not a choice', () => {
    const { model: shown } = readyMomentOf(ready(), NOW)
    expect(shown.value).toBeNull()
    expect(shown.fallback).toEqual({ agent: 'claude', model: 'opus', effort: 'high' })
    expect(shown.recommended).toEqual({
      words: 'opus · high',
      why: 'Nine requirements across three repositories: a model that holds a long plan.',
    })
    expect(shown.agents.map((agent) => agent.id)).toEqual(['claude'])
  })

  test('a model chosen for the mission is the picker’s value, the Planner’s advice beside it', () => {
    const { model: shown } = readyMomentOf(
      ready({
        model: model({
          level: 'mission',
          setting: { agent: 'claude', model: 'sonnet', effort: 'medium' },
        }),
      }),
      NOW,
    )
    expect(shown.value).toEqual({ agent: 'claude', model: 'sonnet', effort: 'medium' })
    expect(shown.recommended?.words).toBe('opus · high')
  })

  test('without a recommendation, the model is said and nothing else', () => {
    const { model: shown } = readyMomentOf(ready({ spec: spec({ recommendation: null }) }), NOW)
    expect(shown.recommended).toBeUndefined()
  })
})

describe('The pre-launch check as the Ready card says it', () => {
  test('nothing asked yet: Launch waits', () => {
    expect(launchCheckOf(ready(), NOW)).toEqual({ state: 'idle' })
  })

  test('asked and on its way: its step under way, in words', () => {
    expect(launchCheckOf(ready({ checking: true }), NOW)).toEqual({
      state: 'checking',
      step: 'Starts the check',
    })
    const running = check({
      state: 'running',
      endedAt: null,
      steps: [
        { step: 'dependencies', state: 'done', said: 'ACME-9 is Done' },
        { step: 'base', state: 'running', said: 'Fetches api, web and shared' },
      ],
    })
    expect(launchCheckOf(ready({ check: running }), NOW)).toEqual({
      state: 'checking',
      step: 'Fetches api, web and shared',
    })
  })

  test('nothing moved since the Freeze', () => {
    expect(launchCheckOf(ready({ check: check() }), NOW)).toEqual({ state: 'clear' })
  })

  test('things moved and the Spec holds: each handed file with the agent’s verdict and reason', () => {
    const moved = check({
      moved: [],
      handed: [
        {
          repository: 'api',
          path: 'src/invoices/invoices.query.ts',
          kind: 'other',
          status: 'M',
          answer: { matters: false, why: 'Only a column renamed.' },
        },
      ],
      agent: { state: 'reported', summary: 'Nothing breaks the Spec', said: 'Reported' },
    })
    expect(launchCheckOf(ready({ check: moved }), NOW)).toEqual({
      state: 'moved',
      moved: [
        {
          kind: 'other',
          what: 'api/src/invoices/invoices.query.ts',
          how: 'Changed on the base since the Freeze',
          verdict: { holds: true, why: 'Only a column renamed.' },
        },
      ],
    })
  })

  test('outdated: what moved, in the order of #149, a file the agent says breaks the Spec', () => {
    const outdated = check({
      moved: [
        {
          kind: 'ticket',
          repository: null,
          path: null,
          status: null,
          added: null,
          removed: null,
          said: 'acme/shop#41: its description changed',
        },
        {
          kind: 'target',
          repository: 'api',
          path: 'src/invoices/export.query.ts',
          status: 'M',
          added: 88,
          removed: 14,
          said: 'A file T1 targets changed',
        },
        {
          kind: 'agent',
          repository: 'api',
          path: 'src/invoices/rules.ts',
          status: 'A',
          added: null,
          removed: null,
          said: 'api/src/invoices/rules.ts matters, the agent of the check says: …',
        },
        {
          kind: 'dirty',
          repository: 'shared',
          path: 'src/money.ts',
          status: 'M',
          added: null,
          removed: null,
          said: 'Uncommitted at Freeze, committed since',
        },
      ],
      handed: [
        {
          repository: 'api',
          path: 'src/invoices/rules.ts',
          kind: 'other',
          status: 'A',
          answer: { matters: true, why: 'A first export without filters already exists.' },
        },
      ],
      agent: { state: 'reported', summary: null, said: 'Reported' },
      verdict: {
        outdated: true,
        blockedBy: [],
        actions: ['launch_anyway', 'back_to_planning'],
        said: 'Outdated',
      },
    })
    const found = launchCheckOf(ready({ check: outdated }), NOW)
    expect(found.state).toBe('outdated')
    expect('moved' in found ? found.moved.map((one) => [one.kind, one.what, one.how]) : []).toEqual(
      [
        ['target', 'api/src/invoices/export.query.ts', '+88 −14'],
        [
          'ticket',
          'acme/shop#41: its description changed',
          'acme/shop#41: its description changed',
        ],
        ['dirty', 'shared/src/money.ts', 'Uncommitted at Freeze, committed since'],
        ['other', 'api/src/invoices/rules.ts', 'Changed on the base since the Freeze'],
      ],
    )
    expect('moved' in found ? found.moved[3]?.verdict : undefined).toEqual({
      holds: false,
      why: 'A first export without filters already exists.',
    })
  })

  test('not fetched since a date: the last fetch that worked, in words', () => {
    const unfetched = check({
      bases: [
        {
          repositoryId: 'r-api',
          repository: 'api',
          frozen: 'a1',
          commit: 'a1',
          ref: 'origin/main',
          freshness: NotFetchedSince.make({ since: at(18, 20, 1), reason: 'offline' }),
        },
      ],
      verdict: {
        outdated: false,
        blockedBy: [],
        actions: ['launch', 'check_again'],
        said: 'Not fetched',
      },
    })
    expect(launchCheckOf(ready({ check: unfetched }), NOW)).toEqual({
      state: 'unfetched',
      since: 'yesterday at 18:20',
      moved: [],
    })
  })

  test('the agent of the check did not answer: the files handed have no verdict', () => {
    const silent = check({
      handed: [
        {
          repository: 'web',
          path: 'package.json',
          kind: 'manifest',
          status: 'M',
          answer: null,
        },
      ],
      agent: { state: 'unanswered', summary: null, said: 'The agent did not answer' },
      verdict: {
        outdated: false,
        blockedBy: [],
        actions: ['launch', 'check_again'],
        said: 'Unchecked',
      },
    })
    expect(launchCheckOf(ready({ check: silent }), NOW)).toEqual({
      state: 'silent',
      moved: [
        { kind: 'other', what: 'web/package.json', how: 'Changed on the base since the Freeze' },
      ],
    })
  })

  test('the launch refused because something moved since: check again', () => {
    expect(launchCheckOf(ready({ check: check(), expired: true }), NOW)).toEqual({
      state: 'expired',
    })
  })

  test('a dependency not Done any more: the launch waits for it', () => {
    const blocked = check({
      dependencies: [{ key: 'ACME-9', stage: 'review', done: false }],
      verdict: { outdated: false, blockedBy: ['ACME-9'], actions: [], said: 'Blocked by ACME-9' },
    })
    expect(launchCheckOf(ready({ check: blocked }), NOW)).toEqual({
      state: 'dependency',
      dependency: { key: 'ACME-9', title: 'Customer time zones in the api', stage: 'Review' },
    })
  })

  test('a check that could not finish says why', () => {
    const failed = check({
      state: 'failed',
      steps: [{ step: 'base', state: 'failed', said: 'web could not be read' }],
      verdict: { outdated: false, blockedBy: [], actions: ['check_again'], said: 'Failed' },
    })
    expect(launchCheckOf(ready({ check: failed }), NOW)).toEqual({
      state: 'failed',
      reason: 'web could not be read',
    })
  })
})

describe('The preparation of the Workspace', () => {
  test('the recipe’s steps and where each stands', () => {
    const moment = readyMomentOf(ready({ check: check(), preparation: preparation() }), NOW)
    expect(moment.preparation).toEqual([
      { name: 'Worktree api', state: 'done' },
      { name: 'Copy .env', state: 'done', detail: 'api' },
      { name: 'Run pnpm install', state: 'running', detail: 'web' },
    ])
  })

  test('a failed step is said with what it was doing', () => {
    const failed = preparation({
      state: 'failed',
      needId: 'n9',
      steps: [
        {
          id: 'p3',
          position: 1,
          kind: 'run',
          base: 'web',
          path: null,
          commandId: 'install',
          line: 'pnpm install',
          state: 'failed',
          failure: { doing: 'pnpm install', output: MaskedText.make('ERR_PNPM_FETCH_401') },
        },
      ],
    })
    expect(readyMomentOf(ready({ check: check(), preparation: failed }), NOW).preparation).toEqual([
      { name: 'Run pnpm install', state: 'failed', detail: 'pnpm install failed' },
    ])
  })
})

describe('The mission’s own things', () => {
  test('each grant in words: who allowed it, when, how many times it served', () => {
    const shown = missionThingsOf(
      things({
        grants: [
          grant(),
          grant({ id: 'g2', state: 'revoked' }),
          grant({ id: 'g3', state: 'fallen', reason: 'the script changed' }),
        ],
      }),
      NOW,
    )
    expect(shown.grants).toEqual([
      {
        id: 'g1',
        action: 'Run the api’s database migrations on the test database',
        by: 'You',
        at: 'today at 09:31',
        uses: 4,
      },
    ])
  })

  test('the budget: the limit nearest its end, each limit, and the usage measured', () => {
    expect(budgetOf(budget())).toEqual({
      cap: '30 tries',
      spent: '12',
      share: 0.4,
      limits: ['1 of 8 launches', '12 of 30 tries', '0 of 3 rounds'],
      usage: '$12.40 · 4.1 M tokens',
      estimated: false,
    })
  })

  test('a usage the agents did not report is marked as an estimate', () => {
    const shown = budgetOf(
      budget({
        usage: {
          inputTokens: 800_000,
          outputTokens: 100_000,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          cachedShare: null,
          cost: null,
          measured: false,
        },
      }),
    )
    expect(shown.usage).toBe('900 k tokens')
    expect(shown.estimated).toBe(true)
  })

  test('before anything is read, no limit and no usage', () => {
    expect(budgetOf(null)).toEqual({
      cap: null,
      spent: 'Nothing used',
      share: null,
      estimated: false,
    })
  })
})

describe('Building’s percentage', () => {
  test('counts the Spec’s tasks done and verified, of those not skipped', () => {
    const view = building({
      tasks: [
        task({ id: 'T1', state: 'done', verified: true }),
        task({ id: 'T2', state: 'done', verified: false }),
        task({ id: 'T3', state: 'in_progress', verified: null }),
        task({ id: 'T4', state: 'skipped', verified: null }),
        task({ id: 'RV1', origin: 'review', state: 'done', verified: true }),
      ],
    })
    expect(percentOf(view)).toBe(33)
  })

  test('is nothing before a task is planned', () => {
    expect(percentOf(building({ tasks: [] }))).toBe(0)
  })
})

describe('The Building page in its own words', () => {
  test('now: the main session’s line first, then what comes next', () => {
    const moment = buildingMomentOf(
      reading({
        now: now({
          next: { sessionId: 's1', role: 'builder', text: 'Then T3', updatedAt: at(10, 59) },
        }),
      }),
      NOW,
    )
    expect(moment.now).toBe('Writes the export button (T2)')
    expect(moment.next).toBe('Then T3')
    expect(moment.face).toBe('writing')
  })

  test('now while the user is waited on: the need in words, and the face asks', () => {
    const moment = buildingMomentOf(
      reading({
        now: now({
          waiting: [{ needId: 'n1', kind: 'permission', sentence: 'A permission waits for you' }],
        }),
      }),
      NOW,
    )
    expect(moment.face).toBe('permission')
  })

  test('the spine: each requirement with its title, its tasks and its scenarios’ proofs', () => {
    const moment = buildingMomentOf(reading(), NOW)
    expect(moment.requirements.map((one) => [one.id, one.title])).toEqual([
      ['R1', 'Export the invoices of the current filters as CSV'],
      ['R2', 'Name the file after the filters'],
    ])
    expect(moment.requirements[0]?.tasks).toEqual([
      { id: 'T1', title: 'Add the export endpoint', state: 'verified', repositories: ['api'] },
      {
        id: 'T2',
        title: 'The export button on the billing page',
        state: 'running',
        repositories: ['web'],
      },
    ])
    expect(moment.requirements[0]?.scenarios).toEqual([
      { id: 'S1', title: 'The file holds the filtered invoices', proof: 'green' },
      { id: 'S2', title: 'No filter exports every invoice', proof: 'red' },
    ])
    expect(moment.requirements[1]?.scenarios[0]?.proof).toBe('none')
  })

  test('every task state as its mark says it, a blocked one with its cause', () => {
    const states = buildingMomentOf(
      reading({
        building: building({
          requirements: [
            {
              id: 'R1',
              done: false,
              tasks: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
              proven: false,
              scenarios: [],
              byHand: { total: 0, validated: 0 },
            },
          ],
          tasks: [
            task({ id: 'T1', state: 'done', verified: true }),
            task({ id: 'T2', state: 'done', verified: false }),
            task({ id: 'T3', state: 'checking', verified: null }),
            task({
              id: 'T4',
              state: 'blocked',
              blockedBy: 'waits for your answer',
              verified: null,
            }),
            task({ id: 'T5', state: 'skipped', verified: null }),
            task({ id: 'T6', state: 'available', verified: null }),
            task({ id: 'T7', state: 'waiting', verified: null }),
          ],
        }),
      }),
      NOW,
    ).requirements[0]?.tasks
    expect(states?.map((one) => one.state)).toEqual([
      'verified',
      'unverified',
      'running',
      'blocked',
      'skipped',
      'todo',
      'todo',
    ])
    expect(states?.[3]?.cause).toBe('waits for your answer')
  })

  test('a task blocked on a need of the user waits for them; one that failed counts its tries', () => {
    const tasks = buildingMomentOf(
      reading({
        building: building({
          requirements: [
            {
              id: 'R1',
              done: false,
              tasks: ['T1'],
              proven: false,
              scenarios: [],
              byHand: { total: 0, validated: 0 },
            },
          ],
          tasks: [
            task({
              id: 'T1',
              state: 'blocked',
              verified: null,
              blockedBy: 'A decision waits for you',
              attempts: [
                attempt({ id: 'a1', verdict: 'red' }),
                attempt({ id: 'a2', number: 2, verdict: 'red' }),
              ],
            }),
          ],
          decisions: [
            {
              id: 'dec1',
              needId: 'n1',
              kind: 'error',
              tasks: ['T1'],
              question: 'T1 failed three times',
              options: ['Retry', 'Skip T1'],
              recommended: null,
              amendment: null,
              state: 'pending',
              answer: null,
              applied: false,
              requestedAt: at(10, 40),
              answeredAt: null,
            },
          ],
        }),
        now: now({ waiting: [{ needId: 'n1', kind: 'decision', sentence: 'T1 cannot…' }] }),
      }),
      NOW,
    ).requirements[0]?.tasks
    expect(tasks?.[0]?.state).toBe('waiting')
    expect(tasks?.[0]?.failures).toBe(2)
  })

  test('each scenario’s proof: red recorded, green, to re-run (never green when stale), to verify by hand', () => {
    const proofs = buildingMomentOf(
      reading({
        building: building({
          requirements: [
            {
              id: 'R1',
              done: false,
              tasks: [],
              proven: false,
              scenarios: [
                proof({ scenario: 'S1', state: 'green', upToDate: false }),
                proof({ scenario: 'S2', state: 'to_rerun' }),
                proof({ scenario: 'S3', state: 'to_verify', mode: 'by_hand' }),
                proof({ scenario: 'S4', state: 'validated', mode: 'by_hand' }),
                proof({ scenario: 'S5', state: 'held' }),
                proof({
                  scenario: 'S6',
                  state: 'red_recorded',
                  red: {
                    id: 'pr1',
                    phase: 'red',
                    line: 'pnpm test',
                    testPath: null,
                    testSha256: null,
                    exitCode: 1,
                    classification: 'assertion_failed',
                    failingTest: null,
                    assertion: null,
                    keyLineMatched: null,
                    outputTail: '',
                    evidenceId: null,
                    testEvidenceId: null,
                    runId: null,
                    trees: [],
                    at: at(9, 14),
                  },
                }),
              ],
              byHand: { total: 2, validated: 1 },
            },
          ],
          tasks: [],
        }),
      }),
      NOW,
    ).requirements[0]?.scenarios
    expect(proofs?.map((one) => one.proof)).toEqual([
      'rerun',
      'rerun',
      'manual',
      'green',
      'none',
      'red',
    ])
    expect(proofs?.[5]?.redAt).toBe('09:14')
  })

  test('the special tasks of the review stand apart, out of the requirements', () => {
    const moment = buildingMomentOf(
      reading({
        building: building({
          tasks: [
            ...building().tasks,
            task({
              id: 'RV1',
              title: 'Close the stream when the user leaves',
              origin: 'review',
              requirements: [],
              state: 'available',
              verified: null,
            }),
          ],
        }),
      }),
      NOW,
    )
    expect(moment.special.map((one) => one.id)).toEqual(['RV1'])
    expect(moment.requirements.flatMap((one) => one.tasks.map((t) => t.id))).not.toContain('RV1')
  })

  test('the checks: quiet after a requirement, standing out when red, the final ones in full', () => {
    const red = {
      name: 'test',
      place: 'web',
      verdict: 'red' as const,
      detail: '1 failed',
      outputTail: 'FAIL export-button.test.tsx\nUnable to find role="progressbar"',
      runId: 'run-1',
      line: 'pnpm test',
      exitCode: 1,
      value: null,
      trees: [],
      evidenceId: null,
      shown: 'stands-out' as const,
      at: at(10, 40),
    }
    const moment = buildingMomentOf(
      reading({
        building: building({
          scopes: [
            attempt({
              id: 'r1',
              scope: 'requirement',
              subject: 'R1',
              checks: [
                { ...red, name: 'lint', verdict: 'green', shown: 'quiet', outputTail: '' },
                { ...red, at: at(10, 30), verdict: 'green', shown: 'quiet', outputTail: '' },
              ],
            }),
            attempt({ id: 'r2', scope: 'requirement', subject: 'R2', checks: [red] }),
            attempt({
              id: 'e1',
              scope: 'end',
              checks: [{ ...red, place: 'api', verdict: 'green', shown: 'final', outputTail: '' }],
            }),
          ],
        }),
      }),
      NOW,
    )
    expect(moment.checks).toEqual([
      { repository: 'web', name: 'lint', state: 'done', final: false, after: 'after R1' },
      {
        repository: 'web',
        name: 'test',
        state: 'failed',
        final: false,
        after: 'after R2',
        tail: ['FAIL export-button.test.tsx', 'Unable to find role="progressbar"'],
      },
      { repository: 'api', name: 'test', state: 'done', final: true, after: 'final' },
    ])
  })

  test('the changes per repository, one changed outside Hemera said so', () => {
    const file = {
      treePath: 'x',
      oldPath: null,
      letter: 'M' as const,
      untracked: false,
      binary: false,
      sizeBefore: 1,
      sizeAfter: 2,
      generated: false,
      large: false,
      changedOutside: null,
      withheld: false,
    }
    const moment = buildingMomentOf(
      reading({
        diff: diff({
          repositories: [
            {
              repository: 'api',
              branch: 'feat/acme-12-export-invoices',
              baseBranch: 'origin/main',
              baseCommit: 'a1',
              tree: null,
              files: [
                { ...file, repository: 'api', path: 'a.ts', added: 10, removed: 2 },
                { ...file, repository: 'api', path: 'b.ts', added: 4, removed: 0 },
              ],
              added: 14,
              removed: 2,
              changedOutside: false,
              sequence: 1,
              unreadable: null,
            },
            {
              repository: 'web',
              branch: 'feat/acme-12-export-invoices',
              baseBranch: 'origin/main',
              baseCommit: 'b1',
              tree: null,
              files: [
                {
                  ...file,
                  repository: 'web',
                  path: 'c.ts',
                  added: 3,
                  removed: 3,
                  changedOutside: at(10, 0),
                },
              ],
              added: 3,
              removed: 3,
              changedOutside: true,
              sequence: 1,
              unreadable: null,
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.changes).toEqual([
      { repository: 'api', files: 2, added: 14, deleted: 2 },
      { repository: 'web', files: 1, added: 3, deleted: 3, outside: true },
    ])
    expect(moment.outside).toBe('web')
  })

  test('the journal: its meaningful events only, never a tool call, the newest first', () => {
    const moment = buildingMomentOf(
      reading({
        journal: [
          line({ sequence: 12, at: at(10, 58), text: 'R1 proven: S1 green' }),
          line({
            sequence: 11,
            at: at(10, 55),
            kind: 'permission',
            author: HemeraAuthor.make({}),
            text: 'Request 4 ended: allowed',
            fields: { number: 4, tool: 'Bash', result: 'allowed' },
          }),
          line({
            sequence: 10,
            at: at(9, 31),
            kind: 'permission',
            author: UserAuthor.make({}),
            text: 'The user allowed for this mission: Run the migrations',
            fields: { grantId: 'g1' },
          }),
        ],
        journalMore: true,
      }),
      NOW,
    )
    expect(moment.journal).toEqual([
      { at: '10:58', text: 'R1 proven: S1 green' },
      { at: '09:31', text: 'The user allowed for this mission: Run the migrations' },
    ])
    expect(moment.journalMore).toBe(true)
  })

  test('the services: state, address, the stopped ones to start again, the catalogue’s others', () => {
    const moment = buildingMomentOf(
      reading({
        services: [
          service(),
          service({
            runId: 'run-web',
            commandId: 'cmd-web',
            name: 'web',
            state: 'not answering',
            url: null,
          }),
          service({
            runId: 'run-worker',
            commandId: 'cmd-worker',
            name: 'worker',
            state: 'stopped',
            url: null,
            endedAt: at(10, 30),
            dismissable: true,
          }),
        ],
        catalogue: [
          command(),
          command({ id: 'cmd-web', name: 'web', line: 'pnpm --filter web dev' }),
          command({ id: 'cmd-worker', name: 'worker', line: 'pnpm --filter api worker' }),
          command({ id: 'cmd-mail', name: 'mailpit', line: 'docker compose up mailpit' }),
          command({ id: 'cmd-test', name: 'test', type: 'test', line: 'pnpm test' }),
          command({ id: 'cmd-docs', name: 'docs', scope: 'project', line: 'pnpm docs' }),
        ],
      }),
      NOW,
    )
    expect(moment.services).toEqual([
      {
        id: 'run-api',
        name: 'api',
        state: 'running',
        url: 'http://localhost:3012',
        line: 'pnpm --filter api dev',
      },
      { id: 'run-web', name: 'web', state: 'blocked', line: 'pnpm --filter web dev' },
    ])
    expect(moment.idle).toEqual([
      {
        id: 'run-worker',
        name: 'worker',
        line: 'pnpm --filter api worker',
        state: 'idle',
        dismissable: true,
      },
    ])
    expect(moment.catalogue).toEqual([
      { id: 'cmd-mail', name: 'mailpit', line: 'docker compose up mailpit' },
    ])
  })

  test('the chips: helpers, the documenter, the reviewers, a stuck one said so', () => {
    const moment = buildingMomentOf(
      reading({
        helpers: [helper(), helper({ id: 'h2', label: 'H2', stuck: true, step: null })],
        building: building({
          phase: 'review',
          documenter: [
            {
              id: 'dp1',
              number: 1,
              mode: 'full',
              state: 'reported',
              files: [],
              attemptId: 'a9',
              changed: [],
              noChangeReason: null,
              evidenceId: null,
              failure: null,
              startedAt: at(10, 20),
              endedAt: at(10, 30),
            },
          ],
        }),
        review: review({
          passes: [
            {
              id: 'rp1',
              reviewer: 'code-reviewer',
              state: 'running',
              startedAt: at(10, 40),
              endedAt: null,
              failure: null,
              counts: { blocking: 0, warning: 0, suggestion: 0 },
            },
            {
              id: 'rp2',
              reviewer: 'spec-reviewer',
              state: 'done',
              startedAt: at(10, 35),
              endedAt: at(10, 45),
              failure: null,
              counts: { blocking: 0, warning: 1, suggestion: 0 },
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.helpers.map((one) => [one.id, one.name, one.kind, one.state, one.step])).toEqual([
      ['h1', 'H1', 'helper', 'running', 'Writes the labels of the export menu'],
      ['h2', 'H2', 'helper', 'stuck', 'No sign for a while'],
      ['dp1', 'Documenter', 'documenter', 'finished', 'Wrote the documentation'],
      ['rp1', 'Code reviewer', 'reviewer', 'running', 'Reads the changes'],
      ['rp2', 'Spec reviewer', 'reviewer', 'finished', '1 finding'],
    ])
  })

  test('the end phases: the automatic review under way says how many reviewers are done', () => {
    const moment = buildingMomentOf(
      reading({
        building: building({ phase: 'review' }),
        review: review({
          passes: [
            {
              id: 'rp1',
              reviewer: 'code-reviewer',
              state: 'running',
              startedAt: at(10, 40),
              endedAt: null,
              failure: null,
              counts: { blocking: 0, warning: 0, suggestion: 0 },
            },
            {
              id: 'rp2',
              reviewer: 'spec-reviewer',
              state: 'done',
              startedAt: at(10, 35),
              endedAt: at(10, 45),
              failure: null,
              counts: { blocking: 0, warning: 0, suggestion: 0 },
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.phases).toEqual([
      { id: 'tasks', title: 'Tasks', state: 'done' },
      { id: 'documentation', title: 'Documentation', state: 'done' },
      { id: 'final-checks', title: 'Final checks', state: 'done' },
      { id: 'review', title: 'Automatic review', state: 'running', detail: '1 of 2 done' },
      { id: 'special', title: 'Special tasks', state: 'todo' },
    ])
  })

  test('the round: its number in the label, the requirements still under it', () => {
    const moment = buildingMomentOf(
      reading({
        building: building({ label: 'Building · round 2', round: { number: 2, points: [] } }),
      }),
      NOW,
    )
    expect(moment.round).toBe(2)
  })

  test('the Workspace and its branch', () => {
    const moment = buildingMomentOf(reading(), NOW)
    expect(moment.workspace).toBe('acme-12')
    expect(moment.branch).toBe('feat/acme-12-export-invoices')
    expect(moment.elapsed).toBe('1 h 0 min')
  })
})

describe('A task’s view', () => {
  test('its targets, its tries with who ran them, its files, what judged it, its conflicts', () => {
    const view = building()
    const one = task({
      id: 'T2',
      title: 'The export button on the billing page',
      targets: [
        { repository: 'web', path: 'src/billing/export-button.tsx', intent: 'change' },
        { repository: 'shared', path: 'src/export/progress.ts', intent: 'create' },
      ],
      state: 'in_progress',
      verified: null,
      attempts: [
        attempt({
          id: 'a1',
          number: 1,
          startedAt: at(10, 0),
          endedAt: at(10, 11),
          verdict: 'red',
          files: [
            {
              repository: 'web',
              path: 'src/billing/export-button.tsx',
              status: 'M',
              added: 48,
              removed: 6,
              outside: false,
            },
            {
              repository: 'web',
              path: 'src/billing/invoice-row.tsx',
              status: 'M',
              added: 3,
              removed: 3,
              outside: true,
            },
          ],
          checks: [
            {
              name: 'test',
              place: 'web',
              verdict: 'red',
              detail: '1 failed',
              outputTail: 'FAIL export-button.test.tsx',
              runId: null,
              line: null,
              exitCode: 1,
              value: null,
              trees: [],
              evidenceId: null,
              shown: 'stands-out',
              at: at(10, 11),
            },
          ],
          conflicts: [
            {
              repository: 'web',
              path: 'src/billing/export-button.tsx',
              command: 'pnpm fmt',
              byTask: 'T2',
              heldBy: 'T5',
            },
          ],
        }),
        attempt({ id: 'a2', number: 2, startedAt: at(10, 12), endedAt: null, verdict: null }),
      ],
    })
    const detail = taskDetailOf(view, one, spec({ stage: 'building' }), NOW)
    expect(detail.requirement).toBe('R1 · Export the invoices of the current filters as CSV')
    expect(detail.targets).toEqual([
      { path: 'web/src/billing/export-button.tsx', intent: 'change' },
      { path: 'shared/src/export/progress.ts', intent: 'create' },
    ])
    expect(detail.tries).toEqual([
      { n: 1, runner: 'Builder · Claude Code · opus · high', state: 'failed', took: '11 min' },
      { n: 2, runner: 'Builder · Claude Code · opus · high', state: 'running', took: '48 min' },
    ])
    expect(detail.files).toEqual([
      { path: 'web/src/billing/export-button.tsx', added: 48, deleted: 6, outside: false },
      { path: 'web/src/billing/invoice-row.tsx', added: 3, deleted: 3, outside: true },
    ])
    expect(detail.verdicts).toEqual([
      { name: 'web · test', state: 'failed', tail: ['FAIL export-button.test.tsx'] },
    ])
    expect(detail.conflicts).toEqual([
      {
        with: 'T5',
        path: 'web/src/billing/export-button.tsx',
        settled: 'pnpm fmt changed it while T5 held it: both changes kept',
      },
    ])
  })

  test('the decision that amended it, in words', () => {
    const view = building({
      decisions: [
        {
          id: 'dec1',
          needId: 'n2',
          kind: 'amendment',
          tasks: ['T2'],
          question: 'T2 cannot keep the amounts unrounded as written',
          options: ['Amend T2', 'Keep T2'],
          recommended: 'Amend T2',
          amendment: 'Keep four decimals, round on display.',
          state: 'answered',
          answer: 'Amend T2',
          applied: true,
          requestedAt: at(10, 15),
          answeredAt: at(10, 20),
        },
      ],
    })
    const detail = taskDetailOf(
      view,
      task({ id: 'T2', decisionId: 'dec1' }),
      spec({ stage: 'building' }),
      NOW,
    )
    expect(detail.amended).toEqual({
      by: 'Your decision at 10:20',
      what: 'Keep four decimals, round on display.',
      at: '10:20',
    })
  })
})

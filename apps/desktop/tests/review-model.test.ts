/**
 * The Review page as the window feeds it (#496): the engine's reads of a mission in Review — its
 * feedback and rounds, the proofs, the final checks, the automatic review, the documenter, the
 * services, the diff — in the words the page uses. The page shows what the engine decides: Fix is
 * there when the engine says a Fix may be pressed, Ship's refusal is the engine's reasons.
 */

import { describe, expect, test } from 'vite-plus/test'

import { reviewMomentOf, type ReviewRead } from '../src/renderer/review-model.ts'
import {
  NOW,
  at,
  building,
  command,
  diff,
  proof,
  review,
  service,
  spec,
  requirement,
} from './building-fixtures.ts'
import { feedback, proofsView, reviewState, shipPreview } from './review-fixtures.ts'

const read = (more: Partial<ReviewRead> = {}): ReviewRead => ({
  round: 0,
  state: reviewState(),
  details: [],
  waves: [],
  spec: spec({
    requirements: [
      requirement({
        id: 'R1',
        text: 'Export the invoices of the current filters as CSV',
        scenarios: [
          {
            id: 'S1',
            when: 'the user exports with a customer filtered',
            then: 'The file holds the filtered invoices',
            version: 1,
            proof: null,
            proofVersion: 1,
          },
          {
            id: 'S2',
            when: 'the user opens the CSV in a spreadsheet',
            then: 'The accents read as written',
            version: 1,
            proof: {
              mode: 'by_hand',
              actions: ['Export the invoices of September', 'Open the file in a spreadsheet'],
              starting_data: 'None.',
              expected: 'Société Générale reads as written',
              seen_today: false,
            },
            proofVersion: 1,
          },
        ],
      }),
    ],
  }),
  building: building({ state: 'ended', phase: 'ended' }),
  review: null,
  proofs: null,
  now: null,
  services: [],
  catalogue: [],
  diff: null,
  pushes: null,
  team: [],
  preview: null,
  progress: null,
  ...more,
})

describe('Review entered', () => {
  test('each scenario shows its red then its green, the one verified by hand waits for the user', () => {
    const moment = reviewMomentOf(
      read({
        proofs: proofsView({
          scenarios: [
            {
              ...proof({ scenario: 'S1', state: 'green' }),
              red: run({ at: at(9, 12) }),
              green: run({ at: at(9, 40) }),
              runs: [],
            },
            { ...proof({ scenario: 'S2', mode: 'by_hand', state: 'to_verify' }), runs: [] },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.proofs).toEqual([
      {
        id: 'S1',
        requirement: 'R1',
        title: 'The file holds the filtered invoices',
        how: 'test',
        state: 'green',
        redAt: '09:12',
        greenAt: '09:40',
      },
      {
        id: 'S2',
        requirement: 'R1',
        title: 'The accents read as written',
        how: 'hand',
        state: 'toVerify',
        steps:
          'Export the invoices of September. Open the file in a spreadsheet. Expected: Société Générale reads as written',
      },
    ])
  })

  test('a green no longer on the current tree is not green: it is to redo', () => {
    const moment = reviewMomentOf(
      read({
        proofs: proofsView({
          scenarios: [
            {
              ...proof({ scenario: 'S1', state: 'green', upToDate: false }),
              red: run({ at: at(9, 12) }),
              green: run({ at: at(9, 40) }),
              runs: [],
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.proofs[0]).toMatchObject({ state: 'red', redo: true })
  })

  test('a proof refused by hand says the user’s reason', () => {
    const moment = reviewMomentOf(
      read({
        proofs: proofsView({
          scenarios: [
            {
              ...proof({
                scenario: 'S2',
                mode: 'by_hand',
                state: 'refused',
                manual: {
                  verdict: 'refused',
                  by: 'user',
                  at: at(10, 0),
                  note: 'The label still wraps.',
                  trees: [],
                },
              }),
              runs: [],
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.proofs[0]).toMatchObject({ state: 'refused', reason: 'The label still wraps.' })
  })

  test('the final checks are in full, one to redo when its result is not on the current tree', () => {
    const moment = reviewMomentOf(
      read({
        proofs: proofsView({
          finalChecks: [
            { name: 'typecheck', place: 'api', verdict: 'green', upToDate: true },
            { name: 'unit tests', place: 'web', verdict: 'red', upToDate: true },
            { name: 'lint', place: 'web', verdict: 'green', upToDate: false },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.checks).toEqual([
      { repository: 'api', name: 'typecheck', state: 'done', after: 'final' },
      { repository: 'web', name: 'unit tests', state: 'failed', after: 'final' },
      { repository: 'web', name: 'lint', state: 'done', after: 'final', redo: true },
    ])
  })
})

describe('What the automatic review saw', () => {
  test('each finding with its fate, and what changed after it, covered by the checks only', () => {
    const moment = reviewMomentOf(
      read({
        building: building({
          state: 'ended',
          tasks: [
            {
              ...building().tasks[0]!,
              id: 'RV1',
              title: 'Apply the read rules when no customer is filtered',
              origin: 'review',
            },
          ],
        }),
        review: review({
          checkpoint: {
            id: 'cp1',
            takenAt: at(11, 20),
            files: [
              { repository: 'api', path: 'src/export.ts', status: 'M', added: 4, removed: 1 },
              { repository: 'web', path: 'src/button.tsx', status: 'M', added: 2, removed: 0 },
            ],
          },
          findings: [
            finding({ number: 1, fate: 'special_task', taskId: 'RV1', taskState: 'done' }),
            finding({
              number: 2,
              reviewer: 'spec-reviewer',
              severity: 'suggestion',
              text: 'S6 checks the progress appears, never that it ends.',
              fate: 'dismissed',
              evidence: 'S7 ends every export it starts',
            }),
          ],
          changedAfter: [
            {
              repository: 'api',
              path: 'src/export.query.ts',
              status: 'M',
              added: 3,
              removed: 1,
              by: 'RV1',
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.saw).toBe('2 files in 2 repositories, at 11:20')
    expect(moment.findings).toEqual([
      {
        id: 'A1',
        severity: 'blocking',
        by: 'Code reviewer',
        text: 'The export query ignores the read rules when no customer is filtered.',
        fate: 'fixed by RV1',
      },
      {
        id: 'A2',
        severity: 'suggestion',
        by: 'Spec reviewer',
        text: 'S6 checks the progress appears, never that it ends.',
        fate: 'dismissed: S7 ends every export it starts',
      },
    ])
    expect(moment.after).toEqual([
      {
        id: 'RV1',
        text: 'Apply the read rules when no customer is filtered',
        files: ['api/src/export.query.ts'],
      },
    ])
  })
})

describe('The documenter', () => {
  test('its reason when it changed nothing', () => {
    const moment = reviewMomentOf(
      read({
        building: building({
          state: 'ended',
          documenter: [documenter({ noChangeReason: 'No page mentions the billing toolbar.' })],
        }),
      }),
      NOW,
    )
    expect(moment.noDocChange).toBe('No page mentions the billing toolbar.')
  })

  test('nothing to say when it changed the documentation', () => {
    const moment = reviewMomentOf(
      read({ building: building({ state: 'ended', documenter: [documenter()] }) }),
      NOW,
    )
    expect(moment.noDocChange).toBeUndefined()
  })
})

describe('Live testing', () => {
  test('the services with their address, a failed one with why, the catalogue’s to start', () => {
    const moment = reviewMomentOf(
      read({
        services: [
          service(),
          service({
            runId: 'run-mail',
            commandId: 'cmd-mail',
            name: 'mailpit',
            state: 'failed',
            url: null,
            outputTail: 'listen tcp :1025: bind: address already in use\n',
            dismissable: true,
          }),
        ],
        catalogue: [
          command(),
          command({ id: 'cmd-mail', name: 'mailpit', line: 'mailpit --smtp 1025' }),
          command({ id: 'cmd-worker', name: 'worker', line: 'pnpm --filter billing worker' }),
          command({ id: 'cmd-lint', name: 'lint', type: 'lint', line: 'pnpm lint' }),
        ],
      }),
      NOW,
    )
    expect(moment.services).toEqual([
      {
        name: 'api',
        state: 'running',
        url: 'http://localhost:3012',
        line: 'pnpm --filter api dev',
      },
      {
        name: 'mailpit',
        state: 'failed',
        line: 'mailpit --smtp 1025',
        error: 'listen tcp :1025: bind: address already in use',
      },
      {
        name: 'worker',
        state: 'stopped',
        line: 'pnpm --filter billing worker',
        removable: false,
      },
    ])
  })
})

describe('Changed outside Hemera', () => {
  test('a repository changed outside Hemera lists its files, and does not hold Ship back', () => {
    const moment = reviewMomentOf(
      read({
        diff: diff({
          repositories: [
            diffRepository('api', [diffFile('src/export.ts')]),
            diffRepository('web', [
              diffFile('src/format.ts', at(10, 30)),
              diffFile('src/button.tsx'),
            ]),
          ],
        }),
        preview: shipPreview({ possible: true, reasons: [] }),
      }),
      NOW,
    )
    expect(moment.changes).toEqual([
      { repository: 'api', files: 1, added: 1, deleted: 1 },
      { repository: 'web', files: 2, added: 2, deleted: 1, outside: ['web/src/format.ts'] },
    ])
    expect(moment.refusals).toEqual([])
  })
})

describe('Ship refused', () => {
  test('its reasons are the engine’s, word for word', () => {
    const moment = reviewMomentOf(
      read({
        preview: shipPreview({
          possible: false,
          reasons: ['2 remarks wait for a Fix.', 'web · unit tests is red.'],
        }),
      }),
      NOW,
    )
    expect(moment.refusals).toEqual(['2 remarks wait for a Fix.', 'web · unit tests is red.'])
  })
})

describe('The feedback by round', () => {
  test('each feedback is named in the order it was written, its round and state as the engine has them', () => {
    const moment = reviewMomentOf(
      read({
        round: 1,
        state: reviewState({
          rounds: [
            { number: 1, state: 'answered', createdAt: at(9, 0), movedAt: at(10, 30) },
            { number: 2, state: 'collecting', createdAt: at(10, 30), movedAt: at(10, 30) },
          ],
          feedback: [
            feedback({
              id: 'fb-b',
              round: 2,
              body: 'A long export shows no progress.',
              createdAt: at(10, 45),
            }),
            feedback({
              id: 'fb-a',
              state: 'addressed',
              answer: 'The dates follow the customer’s time zone now.',
              createdAt: at(9, 5),
            }),
            feedback({
              id: 'fb-c',
              round: 2,
              kind: 'question',
              body: 'Why a stream?',
              createdAt: at(10, 50),
            }),
          ],
          waits: true,
          fixable: true,
        }),
      }),
      NOW,
    )
    expect(moment.remarks.map((one) => [one.id, one.kind, one.state, one.round])).toEqual([
      ['F1', 'remark', 'addressed', 1],
      ['F2', 'remark', 'waiting', 2],
      ['F3', 'question', 'waiting', 2],
    ])
    expect(moment.remarks[0]?.answer).toBe('The dates follow the customer’s time zone now.')
    expect(moment.rounds.map((one) => [one.n, one.state])).toEqual([[1, 'back']])
    expect(moment.fixable).toBe(true)
  })

  test('Fix is not offered while the engine says no Fix may be pressed, whatever waits', () => {
    const moment = reviewMomentOf(
      read({
        state: reviewState({ feedback: [feedback()], waits: true, fixable: false }),
      }),
      NOW,
    )
    expect(moment.remarks[0]?.state).toBe('waiting')
    expect(moment.fixable).toBe(false)
  })
})

function run(more: { at: string }) {
  return {
    id: `run-${more.at}`,
    phase: 'red' as const,
    line: 'pnpm vitest run',
    testPath: 'api/tests/export.test.ts',
    testSha256: null,
    exitCode: 1,
    classification: 'assertion_failed' as const,
    failingTest: null,
    assertion: null,
    keyLineMatched: null,
    outputTail: '',
    evidenceId: null,
    testEvidenceId: null,
    runId: null,
    trees: [],
    at: more.at,
  }
}

function finding(more: Partial<NonNullable<ReviewRead['review']>['findings'][number]> = {}) {
  return {
    id: `finding-${String(more.number ?? 1)}`,
    number: 1,
    reviewer: 'code-reviewer' as const,
    severity: 'blocking' as const,
    requirement: null,
    scenario: null,
    repository: null,
    path: null,
    line: null,
    text: 'The export query ignores the read rules when no customer is filtered.',
    contradictsSpec: false,
    evidence: null,
    fate: null,
    needId: null,
    answer: null,
    taskId: null,
    taskState: null,
    verified: null,
    ...more,
  }
}

function documenter(more: Partial<ReturnType<typeof building>['documenter'][number]> = {}) {
  return {
    id: 'doc-1',
    number: 1,
    mode: 'full' as const,
    state: 'reported' as const,
    files: [],
    attemptId: 'a-doc',
    changed: [],
    noChangeReason: null,
    evidenceId: null,
    failure: null,
    startedAt: at(11, 0),
    endedAt: at(11, 5),
    ...more,
  }
}

function diffFile(path: string, changedOutside: string | null = null) {
  return {
    repository: '',
    path,
    treePath: path,
    oldPath: null,
    letter: 'M' as const,
    untracked: false,
    added: 1,
    removed: changedOutside === null ? 1 : 0,
    binary: false,
    sizeBefore: 10,
    sizeAfter: 12,
    generated: false,
    large: false,
    changedOutside,
    withheld: false,
  }
}

function diffRepository(repository: string, files: ReturnType<typeof diffFile>[]) {
  return {
    repository,
    branch: 'feat/acme-12-export-invoices',
    baseBranch: 'origin/main',
    baseCommit: 'a1',
    tree: 't1',
    files,
    added: files.reduce((sum, one) => sum + (one.added ?? 0), 0),
    removed: files.reduce((sum, one) => sum + (one.removed ?? 0), 0),
    changedOutside: files.some((one) => one.changedOutside !== null),
    sequence: 1,
    unreadable: null,
  }
}

/**
 * The Review page as the window feeds it (#496): the engine's reads of a mission in Review — its
 * feedback and rounds, the proofs, the final checks, the automatic review, the documenter, the
 * services, the diff — in the words the page uses. The page shows what the engine decides: Fix is
 * there when the engine says a Fix may be pressed, Ship's refusal is the engine's reasons.
 */

import { TO_A_MISSION } from '@hemera/core/domain'
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
import {
  feedback,
  proofsView,
  pushes,
  question,
  repositoryPush,
  reviewState,
  roundDetail,
  shipPreview,
  shipProgress,
  teamComment,
} from './review-fixtures.ts'

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
  forges: [],
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

  test('a remark the engine answered with a mission of its own offers to start it, with its images', () => {
    const moment = reviewMomentOf(
      read({
        state: reviewState({
          feedback: [
            feedback({
              state: 'addressed',
              answer: TO_A_MISSION,
              images: [
                {
                  evidenceId: 'ev-1',
                  name: 'header.png',
                  sha256: 'a1',
                  size: 2048,
                  mediaType: 'image/png',
                },
              ],
            }),
            feedback({ id: 'fb-2', state: 'addressed', answer: 'Done.', createdAt: at(10, 5) }),
          ],
        }),
      }),
      NOW,
    )
    expect(moment.remarks.map((one) => one.toMission)).toEqual([true, undefined])
    expect(moment.remarks[0]?.images).toEqual([{ name: 'header.png', size: '2 KB' }])
  })

  test('Withdraw and Resolve are offered as the engine says, whatever the remark stands at', () => {
    const moment = reviewMomentOf(
      read({
        state: reviewState({
          feedback: [
            feedback({ id: 'fb-a', state: 'addressed', withdrawable: true, resolvable: true }),
            feedback({
              id: 'fb-b',
              state: 'addressed',
              withdrawable: false,
              resolvable: false,
              createdAt: at(10, 5),
            }),
            feedback({ id: 'fb-c', state: 'waiting', resolvable: true, createdAt: at(10, 10) }),
          ],
        }),
      }),
      NOW,
    )
    expect(moment.remarks.map((one) => [one.id, one.withdrawable, one.resolvable])).toEqual([
      ['F1', true, true],
      ['F2', false, false],
      ['F3', false, true],
    ])
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

describe('A round, as a small Spec', () => {
  const rounds = reviewState({
    rounds: [
      { number: 1, state: 'answered', createdAt: at(9, 0), movedAt: at(10, 30) },
      { number: 2, state: 'grilling', createdAt: at(10, 30), movedAt: at(10, 45) },
    ],
    feedback: [
      feedback({ id: 'fb-a', round: 1, state: 'addressed', createdAt: at(9, 5) }),
      feedback({ id: 'fb-b', round: 2, state: 'in_round', createdAt: at(10, 35) }),
    ],
  })
  const point = {
    id: 'R2.1',
    text: 'The progress appears after one second only',
    kind: 'behaviour' as const,
    delta: { requirement: 'R4', change: 'modified' as const, livingVersion: 0 },
    sources: ['fb-b'],
    scenarios: [
      {
        id: 'S17',
        when: 'an export lasts half a second',
        then: 'No progress is shown',
        mode: 'automated' as const,
        proof: null,
      },
    ],
    decisions: [],
    removed: false,
    removedReason: null,
  }

  test('its points are named after the remarks they came from, the way the page names them', () => {
    const moment = reviewMomentOf(
      read({
        state: rounds,
        details: [roundDetail({ number: 2, state: 'grilling', points: [point] })],
      }),
      NOW,
    )
    const shown = moment.rounds.find((one) => one.n === 2)
    expect(shown?.points).toEqual([
      {
        id: 'R2.1',
        title: 'The progress appears after one second only',
        kind: 'behaviour',
        sources: ['F2'],
        state: 'todo',
        detail: 'Changes R4',
        scenario: 'S17 · No progress is shown',
      },
    ])
  })

  test('a point clarified against the Spec says the note the user chose', () => {
    const clarified = {
      ...point,
      decisions: [
        {
          kind: 'clarify' as const,
          point: 'R2.1',
          feedbackId: 'fb-b',
          choice: 'D5 replaces the row threshold of R4.',
          alternatives: [],
          why: 'The remark goes against R4.',
        },
      ],
    }
    const moment = reviewMomentOf(
      read({
        state: rounds,
        details: [roundDetail({ number: 2, state: 'building', points: [clarified] })],
      }),
      NOW,
    )
    expect(moment.rounds.find((one) => one.n === 2)?.points[0]?.conflict).toEqual({
      with: 'R4',
      why: 'The remark goes against R4.',
      outcome: 'clarified',
      note: 'D5 replaces the row threshold of R4.',
    })
  })

  test('its questions are those of its grilling, by waves, in Hemera’s options', () => {
    const moment = reviewMomentOf(
      read({
        state: rounds,
        details: [roundDetail({ number: 2, state: 'grilling', questions: ['Q7'] })],
        waves: [
          { number: 1, askedAt: at(8, 0), questions: [question({ id: 'Q1', wave: 1 })] },
          { number: 3, askedAt: at(10, 50), questions: [question()] },
        ],
      }),
      NOW,
    )
    const waves = moment.rounds.find((one) => one.n === 2)?.waves
    expect(waves?.map((one) => [one.n, one.questions.map((asked) => asked.id)])).toEqual([
      [3, ['Q7']],
    ])
    expect(waves?.[0]?.questions[0]?.options.map((one) => one.label)).toEqual([
      'Clarify with a note',
      'Withdraw the remark',
      'Cancel the mission',
    ])
  })

  test('a round in Building says how far it is, and its points as their tasks stand', () => {
    const moment = reviewMomentOf(
      read({
        state: reviewState({
          rounds: [{ number: 1, state: 'building', createdAt: at(9, 0), movedAt: at(9, 30) }],
        }),
        details: [
          roundDetail({
            number: 1,
            state: 'building',
            points: [point, { ...point, id: 'R1.2' }],
            tasks: [
              { id: 'T1', title: '', result: '', points: ['R2.1'], scenarios: [], state: 'done' },
              {
                id: 'T2',
                title: '',
                result: '',
                points: ['R1.2'],
                scenarios: [],
                state: 'running',
              },
            ],
            progress: { done: 1, tasks: 2 },
          }),
        ],
      }),
      NOW,
    )
    const shown = moment.rounds[0]
    expect(shown?.building).toBe('1 of 2 tasks done')
    expect(shown?.points.map((one) => one.state)).toEqual(['done', 'running'])
  })
})

describe('The pull requests', () => {
  test('each repository’s push as it stands, its CI from Ship’s preview, a failure in its words', () => {
    const moment = reviewMomentOf(
      read({
        pushes: pushes({
          repositories: [
            repositoryPush(),
            repositoryPush({
              repositoryId: 'repo-web',
              repository: 'web',
              state: 'failed',
              message: 'remote: Permission to acme/web denied.',
              commit: null,
              pushedAt: null,
              pullRequest: null,
            }),
            repositoryPush({
              repositoryId: 'repo-billing',
              repository: 'billing',
              state: 'waiting-for-cli',
              waitingFor: 'gh',
              pullRequest: null,
            }),
            repositoryPush({
              repositoryId: 'repo-shared',
              repository: 'shared',
              state: 'indeterminate',
              pullRequest: null,
            }),
          ],
        }),
        preview: shipPreview({
          repositories: [
            {
              repository: 'api',
              branch: 'feat/acme-12',
              files: [],
              toRedo: { proofs: [], checks: [] },
              pullRequest: {
                number: 412,
                url: 'https://github.com/acme/api/pull/412',
                ci: 'pending',
              },
            },
          ],
        }),
      }),
      NOW,
    )
    expect(moment.pulls).toEqual([
      {
        repository: 'api',
        state: 'open',
        number: 412,
        url: 'https://github.com/acme/api/pull/412',
        ci: 'running',
      },
      { repository: 'web', state: 'failed', message: 'remote: Permission to acme/web denied.' },
      { repository: 'billing', state: 'signedOut', command: 'gh auth login' },
      { repository: 'shared', state: 'failed' },
    ])
    expect(moment.forge).toBe('GitHub')
  })

  test('the forge is the Project’s, before any pull request; none with the Local preset', () => {
    const forge = (name: 'github' | 'bitbucket-cloud') => ({
      repositoryId: 'repo-api',
      path: 'api',
      forge: name,
      host: null,
      owner: null,
      slug: null,
      forced: false,
      cli: 'gh' as const,
      version: null,
      state: 'ready' as const,
      fix: null,
      detail: null,
    })
    expect(reviewMomentOf(read({ forges: [forge('bitbucket-cloud')] }), NOW).forge).toBe(
      'Bitbucket',
    )
    expect(
      reviewMomentOf(
        read({ forges: [forge('github')], preview: shipPreview({ delivered: { at: at(11, 0) } }) }),
        NOW,
      ).forge,
    ).toBeNull()
  })
})

describe('The team’s comments', () => {
  test('each is named in its order, with where it was written, the agent’s reading and the reply', () => {
    const moment = reviewMomentOf(
      read({
        team: [
          teamComment({
            id: 'tc-2',
            createdAt: at(10, 50),
            kind: 'inline',
            anchor: {
              repository: 'api',
              path: 'src/export.ts',
              side: 'new',
              lines: { start: 88, end: 88 },
              commit: null,
              known: true,
              excerpt: null,
              live: null,
            },
            state: 'feedback',
            myTake: 'One per user.',
          }),
          teamComment({ kind: 'general' }),
        ],
      }),
      NOW,
    )
    expect(moment.team).toEqual([
      {
        id: 'C1',
        author: 'ana.lopez',
        anchor: 'the pull request',
        text: 'Two exports at once would both hit the database.',
        reading: 'Asks for a limit on concurrent exports.',
        draft: 'Good catch: one export per user at a time.',
        state: 'new',
        url: 'https://github.com/acme/api/pull/412#discussion_r9001',
        at: '10:40',
      },
      {
        id: 'C2',
        author: 'ana.lopez',
        anchor: 'api/src/export.ts:88',
        text: 'Two exports at once would both hit the database.',
        reading: 'Asks for a limit on concurrent exports.',
        draft: 'Good catch: one export per user at a time.',
        state: 'inRound',
        take: 'One per user.',
        url: 'https://github.com/acme/api/pull/412#discussion_r9001',
        at: '10:50',
      },
    ])
  })
})

describe('Ship', () => {
  test('its confirmation lists what the engine’s preview says: what leaves, outside, to redo, by hand, rules, CI', () => {
    const moment = reviewMomentOf(
      read({
        pushes: pushes({ repositories: [repositoryPush()] }),
        preview: shipPreview({
          possible: true,
          reasons: [],
          repositories: [
            {
              repository: 'api',
              branch: 'feat/acme-12',
              files: [
                { path: 'src/export.ts', letter: 'M', changedOutside: false },
                { path: 'src/format.ts', letter: 'M', changedOutside: true },
              ],
              toRedo: { proofs: ['S8'], checks: ['unit tests · api'] },
              pullRequest: {
                number: 412,
                url: 'https://github.com/acme/api/pull/412',
                ci: 'passing',
              },
            },
          ],
          manualProofs: [{ scenario: 'S2', state: 'to_verify' }],
          preparationChange: {
            copiedVersion: 1,
            currentVersion: 2,
            differences: [{ repositoryId: 'repo-api', field: 'reviewers' }],
          },
        }),
      }),
      NOW,
    )
    expect(moment.preview).toEqual({
      leaving: [{ repository: 'api', branch: 'feat/acme-12', summary: '2 files' }],
      outside: [{ repository: 'api', path: 'api/src/format.ts' }],
      redo: ['S8', 'unit tests · api'],
      unvalidated: [{ id: 'S2', title: 'The accents read as written' }],
      rules: [{ what: 'api’s reviewers' }],
      ci: [{ repository: 'api', number: 412, state: 'done', words: 'passing' }],
    })
  })

  test('with the Local preset, the confirmation says the merge into each base, nothing pushed', () => {
    const moment = reviewMomentOf(
      read({
        preview: shipPreview({
          possible: true,
          reasons: [],
          delivered: { at: at(11, 0) },
          repositories: [
            {
              repository: 'api',
              branch: 'feat/acme-12',
              files: [],
              toRedo: { proofs: [], checks: [] },
              pullRequest: null,
            },
          ],
        }),
        diff: diff({ repositories: [diffRepository('api', [])] }),
      }),
      NOW,
    )
    expect(moment.forge).toBeNull()
    expect(moment.preview.local).toEqual({ merges: [{ repository: 'api', into: 'main' }] })
  })

  test('the Ship progress: what it re-runs, then the red that stopped it, said', () => {
    const running = reviewMomentOf(
      read({
        progress: shipProgress({
          step: 'rerunning',
          reruns: [
            { kind: 'proof', name: 'S8', state: 'green' },
            { kind: 'check', name: 'unit tests · web', state: 'running' },
            { kind: 'check', name: 'typecheck · web', state: 'waiting' },
          ],
        }),
      }),
      NOW,
    )
    expect(running.shipping).toEqual({
      reruns: [
        { id: 'proof S8', what: 'S8', state: 'done' },
        { id: 'check unit tests · web', what: 'unit tests · web', state: 'running' },
        { id: 'check typecheck · web', what: 'typecheck · web', state: 'todo' },
      ],
    })
    expect(running.face).toBe('checking')
    const stopped = reviewMomentOf(
      read({
        progress: shipProgress({
          step: 'stopped',
          reruns: [{ kind: 'check', name: 'unit tests · web', state: 'red' }],
          message: 'unit tests · web is red after the re-run',
        }),
      }),
      NOW,
    )
    expect(stopped.shipping?.stopped).toBe('unit tests · web is red after the re-run')
    expect(reviewMomentOf(read({ progress: shipProgress() }), NOW).shipping).toBeUndefined()
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

/**
 * The cold read (#91): which report is refused, which finding concerns the tasks only, the brief
 * and the Planner's delivery, and when the cold read is settled for the Freeze (#92).
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type ColdReadFinding,
  type FindingStanding,
  SPEC_SECTIONS,
  type SpecText,
  coldReadBrief,
  coldReadDelivery,
  coldReadReportRefusal,
  coldReadUnsettled,
  findingIdOf,
  severityCounts,
  specRepositories,
  tasksOnly,
} from '../src/domain/index.ts'

const blocking = (where: ReadonlyArray<string>, question?: string): ColdReadFinding =>
  question === undefined
    ? { severity: 'blocking', where, text: 'The separator of the CSV is not said.' }
    : { severity: 'blocking', where, text: 'The separator of the CSV is not said.', question }

describe('A finding about the tasks only', () => {
  test('every item it names is a task', () => {
    expect(tasksOnly(['T1'])).toBe(true)
    expect(tasksOnly(['T1', 'T12'])).toBe(true)
  })

  test('a section, a requirement, a scenario or a proof among them makes it not', () => {
    expect(tasksOnly(['T1', 'R1'])).toBe(false)
    expect(tasksOnly(['R1.S1'])).toBe(false)
    expect(tasksOnly(['R1.S1 proof'])).toBe(false)
    expect(tasksOnly(['impact'])).toBe(false)
  })

  test('naming nothing is not about the tasks', () => {
    expect(tasksOnly([])).toBe(false)
  })
})

describe('The report the cold read ends with', () => {
  test('an empty report is kept', () => {
    expect(coldReadReportRefusal([])).toBeNull()
  })

  test('a blocking finding on the Spec carries its question; on the tasks only it needs none', () => {
    expect(
      coldReadReportRefusal([
        blocking(['R1.S1'], 'Which separator does the CSV use?'),
        blocking(['T2']),
        { severity: 'warning', where: ['risks'], text: 'No risk is named.' },
      ]),
    ).toBeNull()
  })

  test('a blocking finding that is not tasks-only without a question is refused, naming it', () => {
    expect(coldReadReportRefusal([blocking(['T1']), blocking(['R1', 'T1'])])).toBe(
      'refused: nothing was kept. Finding 2 is blocking on R1, T1: write in `question` the question a developer would ask.',
    )
  })

  test('a blank question counts as none', () => {
    expect(coldReadReportRefusal([blocking(['why'], '   ')])).toBe(
      'refused: nothing was kept. Finding 1 is blocking on why: write in `question` the question a developer would ask.',
    )
  })

  test('a finding that names nothing is refused', () => {
    expect(
      coldReadReportRefusal([{ severity: 'suggestion', where: [], text: 'Shorter goals.' }]),
    ).toBe(
      'refused: nothing was kept. Finding 1 names nothing in `where`: name the section, requirement, scenario, proof or task it concerns.',
    )
  })
})

const spec = (): SpecText => ({
  key: 'ACME-12',
  title: 'Export the invoices as CSV',
  type: 'feature',
  language: 'en',
  version: 7,
  sections: SPEC_SECTIONS.map((name) => ({ name, body: `The ${name}.`, version: 1 })),
  requirements: [
    {
      id: 'R1',
      domain: 'invoices',
      delta: 'added',
      livingRef: null,
      livingVersion: null,
      text: 'Invoices export as CSV.',
      version: 1,
      removed: false,
      scenarios: [
        {
          id: 'R1.S1',
          when: 'the user exports',
          then: 'a CSV is saved',
          version: 1,
          proof: {
            mode: 'automated',
            actions: ['Export the invoices'],
            starting_data: 'None.',
            expected: 'A CSV file is saved.',
            seen_today: false,
            test: {
              repository: 'shared',
              path: 'csv.test.ts',
              code: 'test()',
              insertion: 'new_file',
              command: 'pnpm test',
            },
          },
          proofVersion: 1,
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'T1',
      title: 'Export',
      result: 'Invoices export as CSV.',
      requirements: ['R1'],
      scenarios: ['R1.S1'],
      targets: [
        { repository: 'web', path: 'export.ts', intent: 'create' },
        { repository: 'api', path: 'invoices.ts', intent: 'change' },
        { repository: 'web', path: 'menu.ts', intent: 'change' },
      ],
      dependsOn: [],
    },
  ],
  tasksVersion: 1,
  recommendation: null,
})

describe('The brief of a cold read', () => {
  test('the Spec names its repositories in its tasks and its proofs, each once', () => {
    expect(specRepositories(spec())).toEqual(['web', 'api', 'shared'])
  })

  test('a Spec that names none names none', () => {
    expect(specRepositories({ ...spec(), requirements: [], tasks: [] })).toEqual([])
  })

  test('it holds the three lines, nothing of the Memory, the answers or the discussion', () => {
    expect(coldReadBrief('ACME-12', 7, ['api', 'web'])).toEqual({
      label: 'Cold read of ACME-12 · Spec version 7',
      text: 'Read the Spec with spec_read and the code of: api, web\nReport with cold_read_report.',
    })
  })
})

describe('What the Planner is handed', () => {
  const findings = [
    {
      id: findingIdOf(1, 1),
      severity: 'blocking' as const,
      where: ['R1.S1'],
      text: 'The separator is not said.',
      question: 'Which separator does the CSV use?',
      tasksOnly: false,
    },
    {
      id: findingIdOf(1, 2),
      severity: 'blocking' as const,
      where: ['T2'],
      text: 'T2 covers no scenario.',
      question: null,
      tasksOnly: true,
    },
    {
      id: findingIdOf(1, 3),
      severity: 'warning' as const,
      where: ['risks'],
      text: 'No risk is named.',
      question: null,
      tasksOnly: false,
    },
  ]

  test('counts by severity', () => {
    expect(severityCounts(findings)).toEqual({ blocking: 2, warning: 1, suggestion: 0 })
  })

  test('every finding, each flagged with what to do; a tasks-only blocker is never to be asked', () => {
    expect(coldReadDelivery('C1', 7, findings)).toBe(
      [
        'Cold read C1 read version 7 of the Spec: 2 blocking, 1 warning, 0 suggestions.',
        '',
        '- C1.F1 · blocking · R1.S1: The separator is not said.',
        '  Question: Which separator does the CSV use?',
        '  Ask it in your next wave (ask_wave with from_finding "C1.F1").',
        '- C1.F2 · blocking · T2 (the tasks only): T2 covers no scenario.',
        '  Fix the task graph yourself, then cold_read_fixed. Never ask it to the user.',
        '- C1.F3 · warning · risks: No risk is named.',
        '  Fix it if you agree, then cold_read_fixed; otherwise leave it: the user sees it in the report.',
      ].join('\n'),
    )
  })
})

const standing = (more: Partial<FindingStanding>): FindingStanding => ({
  id: 'C1.F1',
  severity: 'blocking',
  tasksOnly: false,
  fate: 'open',
  questionId: null,
  questionSettled: false,
  ...more,
})

describe('Settled or not (read by #92)', () => {
  test('no pass yet is settled', () => {
    expect(coldReadUnsettled(null, null)).toEqual([])
  })

  test('a pass waiting or running is not', () => {
    expect(coldReadUnsettled({ label: 'C2', state: 'waiting_for_slot' }, null)).toEqual([
      'Cold read C2 waits for a free slot.',
    ])
    expect(coldReadUnsettled({ label: 'C2', state: 'running' }, null)).toEqual([
      'Cold read C2 is running.',
    ])
  })

  test('an open blocker, an asked one not integrated, and a tasks-only one not fixed are named', () => {
    expect(
      coldReadUnsettled({ label: 'C1', state: 'done' }, [
        standing({}),
        standing({ id: 'C1.F2', fate: 'asked', questionId: 'Q4' }),
        standing({ id: 'C1.F3', tasksOnly: true }),
      ]),
    ).toEqual([
      'C1.F1 is blocking and not asked yet.',
      'C1.F2 is asked as Q4, and not answered and integrated yet.',
      'C1.F3 is blocking on the tasks: the Planner has not fixed it, and you have not dismissed it.',
    ])
  })

  test('answered and integrated, fixed, dismissed, warnings and suggestions: settled', () => {
    expect(
      coldReadUnsettled({ label: 'C1', state: 'done' }, [
        standing({ fate: 'asked', questionId: 'Q4', questionSettled: true }),
        standing({ id: 'C1.F2', tasksOnly: true, fate: 'fixed' }),
        standing({ id: 'C1.F3', fate: 'dismissed' }),
        standing({ id: 'C1.F4', severity: 'warning' }),
        standing({ id: 'C1.F5', severity: 'suggestion' }),
      ]),
    ).toEqual([])
  })

  test('a failed pass with no pass done before it in its cycle is not settled: another is launched', () => {
    expect(coldReadUnsettled({ label: 'C1', state: 'failed' }, null)).toEqual([
      'Cold read C1 failed: launch another.',
    ])
  })

  test('a failed pass leaves the findings of the last pass done in its cycle to settle', () => {
    expect(coldReadUnsettled({ label: 'C2', state: 'failed' }, [standing({})])).toEqual([
      'C1.F1 is blocking and not asked yet.',
    ])
    expect(coldReadUnsettled({ label: 'C2', state: 'failed' }, [])).toEqual([])
  })
})

/**
 * The tasks of a Building (#141): the states Hemera owns, the ready set, the dependants a blocked
 * task holds, the claims two running tasks cannot share, the amendments a decision brings to the
 * frozen plan (CT-33), and the measures read from them.
 */

import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Amendment,
  type BuildTaskNow,
  TASK_STATES,
  TaskAmendment,
  amendmentProblems,
  amendmentSaid,
  amendedPlan,
  claimHolder,
  dependantsOf,
  percentDone,
  promotable,
  readySet,
  requirementDone,
  settled,
} from '../src/domain/index.ts'

const task = (id: string, more: Partial<BuildTaskNow> = {}): BuildTaskNow => ({
  id,
  title: `Task ${id}`,
  result: `${id} is built.`,
  requirements: ['R1'],
  scenarios: [`R1.S${id.slice(1)}`],
  targets: [{ repository: 'api', path: `${id.toLowerCase()}.ts`, intent: 'change' }],
  dependsOn: [],
  state: 'waiting',
  replacedBy: [],
  ...more,
})

/** The plan with one task moved to a state. */
const moved = (tasks: ReadonlyArray<BuildTaskNow>, id: string, state: BuildTaskNow['state']) =>
  tasks.map((each) => (each.id === id ? task(id, Object.assign({}, each, { state })) : each))

const COVERABLE = {
  requirements: new Set(['R1', 'R2']),
  scenarios: new Set(['R1.S1', 'R1.S2', 'R1.S3', 'R1.S21', 'R2.S1']),
}

describe('Hemera owns the task states', () => {
  test('a task is waiting, available, in progress, checking, done, blocked or skipped', () => {
    expect(TASK_STATES).toEqual([
      'waiting',
      'available',
      'in_progress',
      'checking',
      'done',
      'blocked',
      'skipped',
    ])
  })
})

describe('The ready set is every task whose dependencies are done', () => {
  const plan = [task('T1'), task('T2'), task('T3', { dependsOn: ['T1', 'T2'] })]

  test('at the start T1 and T2 become available at once, T3 waits', () => {
    expect(promotable(plan)).toEqual(['T1', 'T2'])
  })

  test('T3 becomes available only once both T1 and T2 are done', () => {
    const one = moved(plan, 'T1', 'done')
    expect(promotable(one)).toEqual(['T2'])
    const both = moved(one, 'T2', 'done')
    expect(promotable(both)).toEqual(['T3'])
  })

  test('a skipped dependency lets its dependants on', () => {
    const skipped = [task('T1', { state: 'skipped' }), task('T2', { dependsOn: ['T1'] })]
    expect(promotable(skipped)).toEqual(['T2'])
  })

  test('a replaced task lets its dependants on only once every replacement is done', () => {
    const replaced = [
      task('T21', { state: 'skipped', replacedBy: ['T21a', 'T21b'] }),
      task('T21a', { state: 'done' }),
      task('T21b', { state: 'in_progress' }),
      task('T22', { dependsOn: ['T21'] }),
    ]
    expect(promotable(replaced)).toEqual([])
    const done = moved(replaced, 'T21b', 'done')
    expect(promotable(done)).toEqual(['T22'])
  })

  test('the ready set is the available tasks, in the order of the plan', () => {
    const now = [
      task('T1', { state: 'in_progress' }),
      task('T2', { state: 'available' }),
      task('T3', { state: 'available' }),
    ]
    expect(readySet(now).map((one) => one.id)).toEqual(['T2', 'T3'])
  })
})

describe('A need blocks its task and its dependants, not the build', () => {
  test('the dependants of a task, directly or through others', () => {
    const plan = [
      task('T1'),
      task('T2', { dependsOn: ['T1'] }),
      task('T3', { dependsOn: ['T2'] }),
      task('T4'),
    ]
    expect(dependantsOf('T1', plan)).toEqual(['T2', 'T3'])
    expect(dependantsOf('T4', plan)).toEqual([])
  })

  test('the dependants of a replacement are those of the task it replaces', () => {
    const plan = [
      task('T21', { state: 'skipped', replacedBy: ['T21a'] }),
      task('T21a'),
      task('T22', { dependsOn: ['T21'] }),
    ]
    expect(dependantsOf('T21a', plan)).toEqual(['T22'])
  })
})

describe('Claims: two running tasks never share a file', () => {
  const held = [{ taskId: 'T4', repository: 'api', path: 'src/export.ts' }]

  test('a target held by a running task names the task that holds it', () => {
    expect(
      claimHolder([{ repository: 'api', path: 'src/export.ts', intent: 'change' }], held),
    ).toEqual({ taskId: 'T4', repository: 'api', path: 'src/export.ts' })
  })

  test('a target of another repository, or another file, is free', () => {
    expect(
      claimHolder(
        [
          { repository: 'web', path: 'src/export.ts', intent: 'change' },
          { repository: 'api', path: 'src/other.ts', intent: 'create' },
        ],
        held,
      ),
    ).toBeNull()
  })
})

describe('The build is settled once every task is done or skipped', () => {
  test('a blocked task holds the end', () => {
    expect(settled([task('T1', { state: 'done' }), task('T2', { state: 'blocked' })])).toBe(false)
    expect(settled([task('T1', { state: 'done' }), task('T2', { state: 'skipped' })])).toBe(true)
  })

  test('a requirement is done once every task covering it is done or skipped', () => {
    const plan = [
      task('T1', { state: 'done' }),
      task('T2', { state: 'checking', requirements: ['R2'] }),
    ]
    expect(requirementDone('R1', plan)).toBe(true)
    expect(requirementDone('R2', plan)).toBe(false)
  })

  test('the percentage counts the done and skipped tasks over the effective plan', () => {
    expect(
      percentDone([
        task('T1', { state: 'done' }),
        task('T2', { state: 'skipped' }),
        task('T3', { state: 'in_progress' }),
        task('T4'),
      ]),
    ).toBe(50)
    expect(percentDone([])).toBe(0)
  })
})

const decode = Schema.decodeUnknownSync(TaskAmendment)

describe('An amendment changes the effective plan, never a frozen task (CT-33)', () => {
  const plan = [
    task('T1'),
    task('T21', { scenarios: ['R1.S21'] }),
    task('T22', { dependsOn: ['T21'] }),
  ]

  test('removing T21 whose scenario no other task covers is refused, naming the scenario', () => {
    const removal: Amendment = decode({ kind: 'remove', task: 'T21', reason: 'Not needed.' })
    expect(amendmentProblems(plan, removal, COVERABLE)).toEqual([
      'Removing T21 leaves R1.S21 covered by no task of the plan.',
    ])
  })

  test('removing a task whose scenarios another task covers is accepted', () => {
    const covered = [...plan, task('T23', { scenarios: ['R1.S21'] })]
    const removal = decode({ kind: 'remove', task: 'T21', reason: 'T23 does it.' })
    expect(amendmentProblems(covered, removal, COVERABLE)).toEqual([])
  })

  test('a task that is not in the plan, or done, is refused', () => {
    expect(
      amendmentProblems(plan, decode({ kind: 'remove', task: 'T9', reason: 'x' }), COVERABLE),
    ).toEqual(['T9 is not a task of the plan.'])
    const done = moved(plan, 'T1', 'done')
    expect(
      amendmentProblems(done, decode({ kind: 'remove', task: 'T1', reason: 'x' }), COVERABLE),
    ).toEqual(['T1 is done: it stays as it is.'])
  })

  const replacement = decode({
    kind: 'replace',
    task: 'T21',
    by: [
      {
        id: 'T21a',
        title: 'Read the export',
        result: 'The export is read.',
        requirements: ['R1'],
        scenarios: ['R1.S21'],
        targets: [{ repository: 'api', path: 'read.ts', intent: 'create' }],
        depends_on: [],
      },
      {
        id: 'T21b',
        title: 'Write the export',
        result: 'The export is written.',
        requirements: ['R1'],
        scenarios: [],
        targets: [{ repository: 'api', path: 'write.ts', intent: 'create' }],
        depends_on: ['T21a'],
      },
    ],
  })

  test('replacing T21 with T21a and T21b keeps its scenario covered', () => {
    expect(amendmentProblems(plan, replacement, COVERABLE)).toEqual([])
  })

  test('a replacement whose id is taken, or whose scenario is no scenario of the Spec, is refused', () => {
    const taken = decode({
      kind: 'add',
      task: {
        id: 'T22',
        title: 'Again',
        result: 'Again.',
        requirements: ['R1'],
        scenarios: ['R9.S9'],
        targets: [],
        depends_on: ['T7'],
      },
    })
    expect(amendmentProblems(plan, taken, COVERABLE)).toEqual([
      'T22 is already a task of the plan: a new task takes an id of its own.',
      'T22 depends on T7, which is no task of the graph.',
      'T22 covers R9.S9, which is no scenario of the Spec.',
    ])
  })

  test('the amendment in words, for the need', () => {
    expect(amendmentSaid(replacement)).toBe(
      'T21 is replaced by T21a (Read the export) and T21b (Write the export).',
    )
    expect(amendmentSaid(decode({ kind: 'remove', task: 'T21', reason: 'Not needed.' }))).toBe(
      'T21 is removed: Not needed.',
    )
  })

  test('applied, the replaced task is skipped and its replacements join the plan', () => {
    const after = amendedPlan(replacement)
    expect(after.skipped).toEqual([{ id: 'T21', replacedBy: ['T21a', 'T21b'] }])
    expect(after.added.map((one) => [one.id, one.dependsOn])).toEqual([
      ['T21a', []],
      ['T21b', ['T21a']],
    ])
  })
})

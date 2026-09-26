/**
 * The Spec's pure rules (design D7-04, D7-06, D7-08, D7-10): type contracts, the task graph,
 * the ready gate, the phases of the `define` protocol, writability and the key and slug.
 * Each scenario suite is named after the scenario it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  DEFINE_PROTOCOL,
  InvalidAnswerError,
  InvalidSpecPrefixError,
  InvalidSpecTitleError,
  SpecNotWritableError,
  TaskCycleError,
  answerTo,
  answerWords,
  contractOf,
  focusOf,
  nextPhaseStates,
  phaseExit,
  readyGate,
  slugOf,
  specKey,
  specPrefix,
  specPrefixFrom,
  staleAfterWrite,
  storyFailures,
  taskGraph,
  writable,
} from '#index.ts'
import type { PhaseId, PhaseState, SpecPhase, SpecSnapshot, SpecType } from '#index.ts'

import { passingSnapshot, section } from './spec-fixture.ts'

function checks(snapshot: SpecSnapshot): string[] {
  return readyGate(snapshot).map((failure) => failure.check)
}

/** The passing feature as a bug or a maintenance: its own section, and the basis it was shaped on. */
function asType(snapshot: SpecSnapshot, type: 'bug' | 'maintenance'): SpecSnapshot {
  const own = type === 'bug' ? 'reproduction' : 'invariants'
  return {
    ...snapshot,
    revision: { ...snapshot.revision, type },
    sections: snapshot.sections.map((entry) =>
      entry.name === 'behaviour' ? { ...entry, name: own } : entry,
    ),
    phases: snapshot.phases.map((phase) =>
      phase.phase === 'shape'
        ? {
            ...phase,
            basis: { problem: 1, expected_outcome: 1, scope: 1, verification: 1, [own]: 1 },
          }
        : phase,
    ),
  }
}

/** A Spec without any story: no story, no criterion, no link of a task to a story. */
function withoutStory(snapshot: SpecSnapshot): SpecSnapshot {
  return { ...snapshot, stories: [], criteria: [], taskStories: [] }
}

function phasesIn(states: Record<PhaseId, PhaseState>): SpecPhase[] {
  // Fresh rows on every call: setting their state in place touches nothing shared.
  return passingSnapshot().phases.map((phase) =>
    Object.assign(phase, { state: states[phase.phase] }),
  )
}

describe('Each type requires its own section', () => {
  const own = { feature: 'behaviour', bug: 'reproduction', maintenance: 'invariants' } as const

  test.each(['feature', 'bug', 'maintenance'] as const)(
    'a %s without its own section lists that section, and no other type’s',
    (type: SpecType) => {
      const complete = passingSnapshot()
      const snapshot: SpecSnapshot = {
        ...complete,
        revision: { ...complete.revision, type },
        sections: complete.sections.filter((entry) => entry.name !== 'behaviour'),
      }
      const targets = readyGate(snapshot)
        .filter((failure) => failure.check === 'type_contract')
        .map((failure) => failure.target)
      expect(targets).toEqual([own[type]])
    },
  )

  test('the contract is the four base sections plus the type’s own', () => {
    expect(contractOf('bug')).toEqual([
      'problem',
      'expected_outcome',
      'scope',
      'verification',
      'reproduction',
    ])
  })
})

describe('A cyclic dependency is refused', () => {
  const task = (id: string) => ({ ...passingSnapshot().tasks[0]!, id, title: id })
  const tasks = [task('A'), task('B'), task('C')]
  const dependencies = [
    { taskId: 'A', dependsOnId: 'B' },
    { taskId: 'B', dependsOnId: 'C' },
    { taskId: 'C', dependsOnId: 'A' },
  ]

  test('the graph returns the cycle as a closed path by title', () => {
    expect(taskGraph(tasks, dependencies, [], [])).toEqual([
      { kind: 'cycle', target: 'A', path: ['A', 'B', 'C', 'A'] },
    ])
  })

  test('the refusal names the cycle A → B → C → A', () => {
    const [problem] = taskGraph(tasks, dependencies, [], [])
    expect(new TaskCycleError(problem!.path!).message).toContain('A → B → C → A')
  })

  test('the gate lists it as a cycle, named', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      dependencies: [...complete.dependencies, { taskId: 'task-1', dependsOnId: 'task-2' }],
    }
    const failures = readyGate(snapshot)
    expect(failures.map((failure) => failure.check)).toEqual(['cycle'])
    expect(failures[0]!.message).toContain('Render → Button → Render')
  })

  test('an acyclic graph with valid references has no problem', () => {
    const complete = passingSnapshot()
    expect(
      taskGraph(complete.tasks, complete.dependencies, complete.taskStories, complete.stories),
    ).toEqual([])
  })

  test('a link to a task or a story the revision does not hold is a reference problem', () => {
    const complete = passingSnapshot()
    expect(
      taskGraph(
        complete.tasks,
        [{ taskId: 'task-1', dependsOnId: 'ghost' }],
        [{ taskId: 'task-1', storyId: 'nowhere' }],
        complete.stories,
      ),
    ).toEqual([
      { kind: 'unknown_task', target: 'ghost' },
      { kind: 'unknown_story', target: 'nowhere' },
    ])
  })
})

describe('The button is offered only when the checks pass', () => {
  test('a complete draft has an empty gate', () => {
    expect(readyGate(passingSnapshot())).toEqual([])
  })

  const removals: [string, string, (snapshot: SpecSnapshot) => SpecSnapshot][] = [
    [
      'a section of its type',
      'type_contract',
      (s) => ({ ...s, sections: s.sections.filter((entry) => entry.name !== 'behaviour') }),
    ],
    [
      'a section’s body',
      'type_contract',
      (s) => ({
        ...s,
        sections: s.sections.map((entry) =>
          entry.name === 'scope' ? { ...entry, body: '  ' } : entry,
        ),
      }),
    ],
    [
      'a valid reference',
      'references',
      (s) => ({ ...s, dependencies: [{ taskId: 'task-2', dependsOnId: 'ghost' }] }),
    ],
    ['a story’s criterion', 'coverage', (s) => ({ ...s, criteria: [] })],
    ['a story’s covering task', 'coverage', (s) => ({ ...s, taskStories: [] })],
    [
      'every task, with no story, from a bug',
      'coverage',
      (s) => ({ ...withoutStory(asType(s, 'bug')), tasks: [], dependencies: [] }),
    ],
    [
      'the absence of a cycle',
      'cycle',
      (s) => ({
        ...s,
        dependencies: [...s.dependencies, { taskId: 'task-1', dependsOnId: 'task-2' }],
      }),
    ],
    [
      'the absence of a blocking question',
      'blocking_question',
      (s) => ({
        ...s,
        questions: s.questions.map((question) => ({ ...question, resolvedAt: null })),
      }),
    ],
    [
      'a finished phase',
      'phase',
      (s) => ({
        ...s,
        phases: s.phases.map((phase) =>
          phase.phase === 'decompose' ? { ...phase, state: 'open' } : phase,
        ),
      }),
    ],
    [
      'a current basis',
      'phase',
      (s) => ({
        ...s,
        sections: s.sections.map((entry) =>
          entry.name === 'plan' ? { ...entry, version: 2 } : entry,
        ),
      }),
    ],
    [
      'the attestation',
      'attestation',
      (s) => ({ ...s, revision: { ...s.revision, attestedContentVersion: null } }),
    ],
  ]

  test.each(removals)('removing %s lists exactly the %s check', (_what, check, remove) => {
    expect(checks(remove(passingSnapshot()))).toEqual([check])
  })
})

describe('A feature Spec needs a user story with an acceptance criterion', () => {
  test('A feature Spec without a story is not ready', () => {
    const failures = readyGate(withoutStory(passingSnapshot()))
    expect(failures).toEqual([
      {
        check: 'coverage',
        target: 'stories',
        message:
          'a feature Spec needs at least one user story with an acceptance criterion, and it has no story',
      },
    ])
    expect(storyFailures(withoutStory(passingSnapshot()))).toEqual(failures)
  })

  test('A feature Spec whose story has no criterion is not ready', () => {
    const snapshot = { ...passingSnapshot(), criteria: [] }
    expect(readyGate(snapshot)).toEqual([
      {
        check: 'coverage',
        target: 'story-1',
        message: 'the story "Export" has no acceptance criterion',
      },
    ])
    expect(storyFailures(snapshot)).toEqual(readyGate(snapshot))
  })

  test.each(['bug', 'maintenance'] as const)('A %s Spec without a story can be ready', (type) => {
    const snapshot = withoutStory(asType(passingSnapshot(), type))
    expect(readyGate(snapshot)).toEqual([])
    expect(storyFailures(snapshot)).toEqual([])
  })

  test('decompose does not finish a feature without a story', () => {
    expect(
      phaseExit('decompose', withoutStory(passingSnapshot())).map((failure) => failure.target),
    ).toEqual(['stories'])
  })
})

describe('An obsolete request is refused', () => {
  test('an attestation made on an earlier content version is not current', () => {
    const complete = passingSnapshot()
    const snapshot = { ...complete, spec: { ...complete.spec, contentVersion: 11 } }
    const failures = readyGate(snapshot)
    expect(failures.map((failure) => failure.check)).toEqual(['attestation'])
    expect(failures[0]!.message).toBe('the agent attested an earlier content of the Spec')
  })
})

describe('An attestation alone does not freeze', () => {
  test('with the agent’s attestation and an open blocking question, the gate lists the question', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      questions: [{ ...complete.questions[0]!, answer: null, resolvedAt: null }],
    }
    expect(snapshot.revision.attestedContentVersion).toBe(snapshot.spec.contentVersion)
    expect(readyGate(snapshot)).toEqual([
      {
        check: 'blocking_question',
        target: 'question-1',
        message: 'a blocking question is open: Which paper size?',
      },
    ])
  })
})

describe('The unavailable prototype does not block', () => {
  test('when every other check passes, prototype is unavailable and the gate does not list it', () => {
    const snapshot = passingSnapshot()
    expect(snapshot.phases.find((phase) => phase.phase === 'prototype')!.state).toBe('unavailable')
    expect(readyGate(snapshot)).toEqual([])
  })

  test('the protocol declares prototype, unavailable, after shape', () => {
    expect(DEFINE_PROTOCOL.phases.find((phase) => phase.id === 'prototype')).toEqual({
      id: 'prototype',
      dependsOn: ['shape'],
      available: false,
    })
  })
})

describe('A new shaping makes the plan stale', () => {
  test('writing problem after shape, plan and decompose finished makes them stale', () => {
    const phases = phasesIn({
      shape: 'finished',
      plan: 'finished',
      decompose: 'finished',
      prototype: 'unavailable',
    })
    expect(staleAfterWrite('problem', phases)).toEqual(['shape', 'plan', 'decompose'])
  })

  test('a decompose that is not finished is left as it is', () => {
    const phases = phasesIn({
      shape: 'finished',
      plan: 'finished',
      decompose: 'open',
      prototype: 'unavailable',
    })
    expect(staleAfterWrite('problem', phases)).toEqual(['shape', 'plan'])
  })

  test('writing plan never makes shape stale', () => {
    const phases = phasesIn({
      shape: 'finished',
      plan: 'finished',
      decompose: 'finished',
      prototype: 'unavailable',
    })
    expect(staleAfterWrite('plan', phases)).toEqual(['plan', 'decompose'])
  })

  test('their earlier declarations no longer count at the gate', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      sections: complete.sections.map((entry) =>
        entry.name === 'problem' ? section('problem', 'Reshaped.', 2) : entry,
      ),
    }
    expect(readyGate(snapshot)).toEqual([
      {
        check: 'phase',
        target: 'shape',
        message: 'the shape phase was finished on sections that changed since',
      },
    ])
  })
})

describe('Phase states and focus', () => {
  test('a pending phase opens once every dependency is finished, and not before', () => {
    const next = nextPhaseStates(
      phasesIn({
        shape: 'finished',
        plan: 'pending',
        decompose: 'pending',
        prototype: 'unavailable',
      }),
    )
    expect(next.map((phase) => phase.state)).toEqual(['finished', 'open', 'pending', 'unavailable'])
  })

  test('a stale dependency does not open its dependant', () => {
    const next = nextPhaseStates(
      phasesIn({ shape: 'stale', plan: 'pending', decompose: 'pending', prototype: 'unavailable' }),
    )
    expect(next.map((phase) => phase.state)).toEqual(['stale', 'pending', 'pending', 'unavailable'])
  })

  test('the focus is the first open or stale phase in protocol order', () => {
    expect(
      focusOf(
        phasesIn({
          shape: 'finished',
          plan: 'open',
          decompose: 'pending',
          prototype: 'unavailable',
        }),
      ),
    ).toBe('plan')
    expect(
      focusOf(
        phasesIn({ shape: 'open', plan: 'open', decompose: 'open', prototype: 'unavailable' }),
      ),
    ).toBe('shape')
    expect(
      focusOf(
        phasesIn({ shape: 'stale', plan: 'open', decompose: 'pending', prototype: 'unavailable' }),
      ),
    ).toBe('shape')
    expect(
      focusOf(
        phasesIn({ shape: 'stale', plan: 'stale', decompose: 'stale', prototype: 'unavailable' }),
      ),
    ).toBe('shape')
    expect(
      focusOf(
        phasesIn({
          shape: 'finished',
          plan: 'stale',
          decompose: 'stale',
          prototype: 'unavailable',
        }),
      ),
    ).toBe('plan')
    expect(
      focusOf(
        phasesIn({
          shape: 'finished',
          plan: 'finished',
          decompose: 'pending',
          prototype: 'unavailable',
        }),
      ),
    ).toBeNull()
  })

  test('with every phase finished there is no focus', () => {
    expect(focusOf(passingSnapshot().phases)).toBeNull()
  })
})

describe('Phase exit checks', () => {
  test('a complete Spec passes the exit of shape, plan and decompose', () => {
    const snapshot = passingSnapshot()
    for (const phase of ['shape', 'plan', 'decompose'] as const) {
      expect(phaseExit(phase, snapshot)).toEqual([])
    }
  })

  test('shape without a scope fails on the scope, and does not ask for verification', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      sections: complete.sections.filter(
        (entry) => entry.name !== 'scope' && entry.name !== 'verification',
      ),
    }
    expect(phaseExit('shape', snapshot).map((failure) => failure.target)).toEqual(['scope'])
  })

  test('shape fails on an empty title and on a blocking question of its own', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      revision: { ...complete.revision, title: ' ' },
      questions: [{ ...complete.questions[0]!, resolvedAt: null }],
    }
    expect(phaseExit('shape', snapshot).map((failure) => failure.target)).toEqual([
      'title',
      'question-1',
    ])
    expect(phaseExit('plan', snapshot)).toEqual([])
  })

  test('plan needs the plan section', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      sections: complete.sections.filter((entry) => entry.name !== 'plan'),
    }
    expect(phaseExit('plan', snapshot).map((failure) => failure.target)).toEqual(['plan'])
  })

  test('decompose needs a task, a clean graph and covered stories', () => {
    const complete = passingSnapshot()
    expect(
      phaseExit('decompose', { ...complete, tasks: [], dependencies: [], taskStories: [] }).map(
        (failure) => failure.check,
      ),
    ).toEqual(['coverage', 'coverage'])
  })

  test('prototype is unavailable in this version', () => {
    expect(phaseExit('prototype', passingSnapshot())).toEqual([
      { check: 'phase', target: 'prototype', message: 'prototype is unavailable in this version' },
    ])
  })
})

describe('Writability', () => {
  const agent = { kind: 'agent', sessionId: 'session-1' } as const

  test('the writer Session’s agent writes the current draft', () => {
    const { spec, revision } = passingSnapshot()
    expect(writable(spec, revision, agent, null)).toBeNull()
  })

  test('a frozen Spec is refused, with its status', () => {
    const { spec, revision } = passingSnapshot()
    expect(writable({ ...spec, status: 'ready' }, revision, agent, null)).toBe(
      'HEM-7 is ready: only a draft is written',
    )
  })

  test('an old revision is refused', () => {
    const { spec, revision } = passingSnapshot()
    expect(writable({ ...spec, currentRevisionId: 'revision-2' }, revision, agent, null)).toBe(
      'revision 1 of HEM-7 is not its current revision',
    )
  })

  test('another Session’s agent is refused with the writer’s name; a human from it is not', () => {
    const { spec, revision } = passingSnapshot()
    const refusal = writable(spec, revision, { kind: 'agent', sessionId: 'session-2' }, 'Export')
    expect(refusal).toBe('the write right on HEM-7 belongs to the Session "Export"')
    expect(new SpecNotWritableError(refusal!).message).toBe(refusal)
    expect(writable(spec, revision, { kind: 'human', sessionId: 'session-2' }, 'Export')).toBeNull()
  })
})

describe('Key prefix, key and slug', () => {
  test.each([
    ['Hemera', 'HEM'],
    ['Key Road', 'KR'],
    ['pallet bank of the north', 'PBOT'],
    ['Éole', 'EOL'],
    ['Io', 'IO'],
    ['X', 'SPEC'],
    ['', 'SPEC'],
    ['2026 — ?', 'SPEC'],
  ])('%p gives the prefix %p', (name, prefix) => {
    expect(specPrefixFrom(name)).toBe(prefix)
  })

  test('a chosen prefix takes 2 to 4 upper-case Latin letters', () => {
    expect(specPrefix('KEYR')).toBe('KEYR')
    expect(specPrefix('KR')).toBe('KR')
    for (const refused of ['k', 'K', 'kr', 'KEYRO', 'K1', 'ÉO', '']) {
      expect(() => specPrefix(refused)).toThrow(InvalidSpecPrefixError)
    }
  })

  test('the key is the prefix and the number', () => {
    expect(specKey('HEM', 7)).toBe('HEM-7')
  })

  test('the slug is lower case, accent-free and dashed', () => {
    expect(slugOf('  Exporter un Rapport — PDF!  ')).toBe('exporter-un-rapport-pdf')
    expect(slugOf('???')).toBe('spec')
    expect(slugOf('a'.repeat(80))).toHaveLength(60)
  })

  test('an empty title is refused', () => {
    expect(() => slugOf('   ')).toThrow(InvalidSpecTitleError)
  })
})

describe('Answers to a question', () => {
  const question = () => ({ ...passingSnapshot().questions[0]!, answer: null, resolvedAt: null })

  test('an option offered or a text of the human’s own is an answer', () => {
    expect(answerTo(question(), { optionId: 'letter' })).toEqual({
      optionId: 'letter',
      text: null,
    })
    expect(answerTo(question(), { text: ' Tabloid ' })).toEqual({ optionId: null, text: 'Tabloid' })
  })

  test('neither, both, or an option not offered is refused', () => {
    expect(() => answerTo(question(), {})).toThrow(InvalidAnswerError)
    expect(() => answerTo(question(), { text: '  ' })).toThrow(InvalidAnswerError)
    expect(() => answerTo(question(), { optionId: 'a4', text: 'A4' })).toThrow(
      'it names both an option and a text',
    )
    expect(() => answerTo(question(), { optionId: 'a3' })).toThrow('"a3" is not an option')
  })

  test('an answer reads as the label of its option, or as its text', () => {
    expect(answerWords(passingSnapshot().questions[0]!)).toBe('A4')
    expect(answerWords({ ...question(), answer: { optionId: null, text: 'Tabloid' } })).toBe(
      'Tabloid',
    )
    expect(answerWords(question())).toBeNull()
  })
})

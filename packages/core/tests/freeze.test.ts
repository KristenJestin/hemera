/**
 * The Freeze (#92): a dependency that would close a cycle, why the Freeze is not offered yet in
 * words, and what the Planner is handed when the Freeze is refused or the mission comes back.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  OutdatedMark,
  SPEC_CHANGED_SINCE_READ,
  dependencyCycleSaid,
  declarationUnsettled,
  dependencyCycle,
  dependencyUndecidedSaid,
  freezeRefusedDelivery,
  inputAbout,
  markIdentity,
  markSentence,
  outdatedReasonSaid,
  probeUnsettled,
  updateDelivery,
} from '../src/domain/index.ts'

describe('A dependency that would close a cycle is named', () => {
  test('ACME-1 → ACME-2 closes ACME-2 → ACME-3 → ACME-1', () => {
    const edges = [
      { from: 'ACME-2', to: 'ACME-3' },
      { from: 'ACME-3', to: 'ACME-1' },
    ]
    const cycle = dependencyCycle(edges, 'ACME-1', 'ACME-2')
    expect(cycle).toEqual(['ACME-1', 'ACME-2', 'ACME-3', 'ACME-1'])
    expect(dependencyCycleSaid(cycle ?? [])).toBe('ACME-1 → ACME-2 → ACME-3 → ACME-1')
  })

  test('the reverse of an existing dependency closes a cycle of two', () => {
    expect(dependencyCycle([{ from: 'ACME-2', to: 'ACME-1' }], 'ACME-1', 'ACME-2')).toEqual([
      'ACME-1',
      'ACME-2',
      'ACME-1',
    ])
  })

  test('a chain that never comes back closes none', () => {
    const edges = [
      { from: 'ACME-2', to: 'ACME-3' },
      { from: 'ACME-4', to: 'ACME-1' },
    ]
    expect(dependencyCycle(edges, 'ACME-1', 'ACME-2')).toBeNull()
    expect(dependencyCycle([], 'ACME-1', 'ACME-2')).toBeNull()
  })

  test('two missions that both depend on a third close none (a diamond is no cycle)', () => {
    const edges = [
      { from: 'ACME-1', to: 'ACME-3' },
      { from: 'ACME-2', to: 'ACME-3' },
    ]
    expect(dependencyCycle(edges, 'ACME-1', 'ACME-2')).toBeNull()
  })
})

describe('Why the declaration of completeness does not hold for the Freeze', () => {
  test('none was made', () => {
    expect(declarationUnsettled('ACME-12', null, 7)).toBe(
      'The Planner has not declared the Spec of ACME-12 complete yet.',
    )
  })

  test('the Spec was written since: the version declared and the version now', () => {
    expect(declarationUnsettled('ACME-12', 7, 9)).toBe(
      'The Spec changed since the Planner declared it complete at version 7: it is at version 9, and the Planner declares it again.',
    )
  })

  test('a declaration on the current version holds', () => {
    expect(declarationUnsettled('ACME-12', 9, 9)).toBeNull()
  })
})

describe('A Probe holds the Freeze while it is prepared, runs, or is to run again', () => {
  const probe = (state: string) => ({
    label: '#2',
    state,
    question: 'does the export keep accents?',
  })

  test('each live state in words', () => {
    expect(probeUnsettled(probe('preparing'))).toBe(
      'Probe #2 is being prepared: does the export keep accents?',
    )
    expect(probeUnsettled(probe('running'))).toBe('Probe #2 runs: does the export keep accents?')
    expect(probeUnsettled(probe('interrupted'))).toBe(
      'Probe #2 was interrupted and runs again: does the export keep accents?',
    )
  })

  test('a Probe that ended holds nothing', () => {
    for (const state of ['done', 'failed', 'wiping', 'wiped']) {
      expect(probeUnsettled(probe(state))).toBeNull()
    }
  })
})

describe('What the Planner is handed', () => {
  test('a refused Freeze: every failure, and what to do', () => {
    expect(
      freezeRefusedDelivery([
        'T1 changes api/invoices.ts, which does not exist at the base commit 1a2b3c4d5e6f.',
      ]),
    ).toBe(
      [
        'The user tried to freeze the Spec, and Hemera refused it at the base commit it would record:',
        '- T1 changes api/invoices.ts, which does not exist at the base commit 1a2b3c4d5e6f.',
        'Fix each, then declare complete again.',
      ].join('\n'),
    )
  })

  test('an update: the user’s reason, what moved since the Freeze, a free hand', () => {
    expect(
      updateDelivery({
        key: 'ACME-12',
        version: 16,
        reason: 'The export must also cover credit notes.',
        outdated: [
          { reason: 'ticket-changed', difference: 'The ticket now asks for credit notes.' },
          { reason: 'target-moved', difference: 'api/invoices.ts changed on main.' },
        ],
      }),
    ).toBe(
      [
        'The user sent ACME-12 back to Planning: its Spec is no longer frozen (version 16), and you have a free hand on everything in it.',
        'Their reason: The export must also cover credit notes.',
        'What moved since the Freeze:',
        '- the ticket changed: The ticket now asks for credit notes.',
        '- the code moved: api/invoices.ts changed on main.',
        'Read what moved, update the Spec, ask what it raises, then declare complete again.',
      ].join('\n'),
    )
  })

  test('an update with no reason and nothing outdated says so', () => {
    expect(updateDelivery({ key: 'ACME-12', version: 4, reason: null, outdated: [] })).toBe(
      [
        'The user sent ACME-12 back to Planning: its Spec is no longer frozen (version 4), and you have a free hand on everything in it.',
        'They gave no reason, and nothing is marked outdated.',
        'Read what moved, update the Spec, ask what it raises, then declare complete again.',
      ].join('\n'),
    )
  })

  test('a dependency not decided, in words', () => {
    expect(dependencyUndecidedSaid('ACME-2', 'ACME-1')).toBe(
      'ACME-2’s dependency on ACME-1 waits on your decision.',
    )
  })

  test('each outdated reason in words', () => {
    expect(outdatedReasonSaid('ticket-changed')).toBe('the ticket changed')
    expect(outdatedReasonSaid('target-moved')).toBe('the code moved')
    expect(outdatedReasonSaid('dependency-merged')).toBe('a dependency was delivered')
    expect(outdatedReasonSaid('dependency-cancelled')).toBe('a dependency was cancelled')
  })

  test('the user’s refusal of a Freeze on an older version', () => {
    expect(SPEC_CHANGED_SINCE_READ).toBe(
      'The Spec changed since you read it: read what changed, then freeze.',
    )
  })

  test('an accepted dependency is an input of the register', () => {
    expect(inputAbout('dependency_accepted', 'ACME-9', null)).toBe('the dependency on ACME-9')
  })
})

describe('The outdated mark keeps what moved', () => {
  const outdated = OutdatedMark.make({
    reason: 'target-moved',
    reference: 'api',
    difference: 'api/invoices.ts changed on main.',
  })

  test('its sentence and its identity', () => {
    expect(markSentence(outdated)).toBe('outdated')
    expect(markIdentity(outdated)).toBe('outdated:target-moved:api')
  })
})

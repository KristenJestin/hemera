/**
 * A mission's Spec (#85): the one rule that says who writes it, the refusal of a write on a
 * version that is no longer current, the completeness Hemera checks when the Planner declares it
 * complete, the readable file, and the Project's Spec language.
 *
 * Rewritten from `hemera-legacy` (`packages/core/tests/spec.test.ts`, "Writability" and "An
 * obsolete request is refused") against the Planner, the eight sections and requirements.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  SPEC_SECTIONS,
  type SpecText,
  canonicalLanguage,
  completeness,
  renderSpecMarkdown,
  specWriteRefusal,
  staleSaid,
} from '../src/domain/index.ts'

const planner = { key: 'ACME-12', stage: 'planning', frozen: false, role: 'planner' } as const

describe('Writability', () => {
  test('a Planner session of the mission writes its Spec in Planning', () => {
    expect(specWriteRefusal(planner)).toBeNull()
  })

  test('a frozen stage is refused with the sentence the agent reads', () => {
    expect(specWriteRefusal({ ...planner, stage: 'ready' })).toBe(
      'ACME-12 is Ready: the Spec is frozen and nothing writes it.',
    )
    expect(specWriteRefusal({ ...planner, stage: 'building' })).toBe(
      'ACME-12 is Building: the Spec is frozen and nothing writes it.',
    )
  })

  test('a cancelled mission is refused', () => {
    expect(specWriteRefusal({ ...planner, stage: 'cancelled' })).toBe(
      'ACME-12 is Cancelled: nothing writes its Spec.',
    )
  })

  test('a Spec frozen in Planning is refused until the user sends it back', () => {
    expect(specWriteRefusal({ ...planner, frozen: true })).toBe(
      'The Spec of ACME-12 is frozen: nothing writes it until the user sends it back to Planning.',
    )
  })

  test('another role is refused, whatever the stage', () => {
    expect(specWriteRefusal({ ...planner, role: 'builder' })).toBe(
      'Only the Planner of ACME-12 writes its Spec.',
    )
  })
})

describe('An obsolete request is refused', () => {
  test('the refusal names the current version and its text, and says nothing was written', () => {
    expect(staleSaid('why', 2, 3, 'Invoices are exported by hand.')).toBe(
      'refused: why changed since version 2: it is at version 3. Nothing was written. Its text now:\n\nInvoices are exported by hand.',
    )
  })

  test('an item that is still empty says so', () => {
    expect(staleSaid('goals', 1, 0, '')).toBe(
      'refused: goals changed since version 1: it is at version 0. Nothing was written. It is empty.',
    )
  })
})

const scenario = (id: string) => ({
  id,
  when: 'the user exports',
  then: 'a CSV is saved',
  version: 1,
})

const written = (): SpecText => ({
  key: 'ACME-12',
  title: 'Export the invoices as CSV',
  type: 'feature',
  language: 'en',
  version: 9,
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
      scenarios: [scenario('R1.S1')],
    },
  ],
})

const complete = {
  described: true,
  triagePending: false,
  pendingInputs: [],
  openQuestions: [],
  livingChanged: [],
} as const

describe('Completeness', () => {
  test('a complete Spec has no failure', () => {
    expect(completeness(written(), complete)).toEqual([])
  })

  test('every failure is listed with its target and its sentence', () => {
    const spec = written()
    const failures = completeness(
      {
        ...spec,
        sections: spec.sections.map((section) =>
          section.name === 'risks' || section.name === 'why' ? { ...section, body: '  ' } : section,
        ),
        requirements: [
          {
            ...spec.requirements[0]!,
            domain: '',
            scenarios: [{ ...scenario('R1.S1'), then: '' }],
          },
          {
            ...spec.requirements[0]!,
            id: 'R2',
            scenarios: [],
          },
        ],
      },
      { ...complete, described: false, triagePending: true },
    )
    expect(failures).toEqual([
      { target: 'why', sentence: 'Why holds no text: write it, or "None."' },
      { target: 'risks', sentence: 'Risks & trade-offs holds no text: write it, or "None."' },
      { target: 'R1', sentence: 'R1 has no domain.' },
      { target: 'R1.S1', sentence: 'R1.S1 has no THEN.' },
      { target: 'R2', sentence: 'R2 has no scenario.' },
      {
        target: 'mission',
        sentence: 'The mission has no title and type of yours: set them with mission_describe.',
      },
      {
        target: 'triage',
        sentence:
          'Your triage answer waits on the user: the Spec is complete only once they keep the mission.',
      },
    ])
  })

  test('an input not integrated and a question open or waiting are refused, each named', () => {
    const failures = completeness(written(), {
      ...complete,
      pendingInputs: [
        { id: 'I1', kind: 'answer', item: 'Q1', version: 2, state: 'delivered' },
        { id: 'I2', kind: 'waiting', item: 'Q2', version: null, state: 'received' },
      ],
      openQuestions: [
        { id: 'Q3', state: 'open' },
        { id: 'Q2', state: 'waiting' },
      ],
    })
    expect(failures).toEqual([
      {
        target: 'I1',
        sentence:
          'Input I1 (the answer to Q1, version 2) is not integrated: integrate it, then call input_integrated.',
      },
      {
        target: 'I2',
        sentence:
          'Input I2 (Q2 waiting on someone) has not reached you yet: it comes with your next delivery.',
      },
      { target: 'Q3', sentence: "Q3 is open: it waits for the user's answer." },
      {
        target: 'Q2',
        sentence: 'Q2 waits on someone: a complete Spec has no open question.',
      },
    ])
  })

  test('an explicit "None." is text; a removed requirement is not counted', () => {
    const spec = written()
    const none = {
      ...spec,
      sections: spec.sections.map((section) => ({ ...section, body: 'None.' })),
      requirements: [
        ...spec.requirements,
        { ...spec.requirements[0]!, id: 'R2', removed: true, scenarios: [] },
      ],
    }
    expect(completeness(none, complete)).toEqual([])
  })

  test('a Spec with no requirement, or only removed ones, needs one', () => {
    const spec = written()
    const removed = {
      ...spec,
      requirements: [{ ...spec.requirements[0]!, removed: true }],
    }
    expect(completeness(removed, complete)).toEqual([
      { target: 'requirements', sentence: 'The Spec has no requirement.' },
    ])
  })
})

describe('The readable file', () => {
  test('the eight sections in order, the requirements with their scenarios in the fourth', () => {
    const text = renderSpecMarkdown(written())
    const headings = text.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toEqual([
      '## Why',
      '## Goals / Non-goals',
      '## Impact',
      '## Requirements',
      '## Decisions',
      '## Risks & trade-offs',
      '## Migration plan',
      '## Open questions',
    ])
    expect(text).toContain('### R1 · added · invoices')
    expect(text).toContain('- R1.S1: WHEN the user exports THEN a CSV is saved')
    expect(text.startsWith('# ACME-12 · Export the invoices as CSV')).toBe(true)
  })

  test('with versions, every item says its own; a removed requirement is left out', () => {
    const spec = written()
    const text = renderSpecMarkdown(
      {
        ...spec,
        requirements: [...spec.requirements, { ...spec.requirements[0]!, id: 'R2', removed: true }],
      },
      { versions: true },
    )
    expect(text).toContain('## Why (version 1)')
    expect(text).toContain('### R1 · added · invoices (version 1)')
    expect(text).toContain('- R1.S1 (version 1): WHEN the user exports THEN a CSV is saved')
    expect(text).not.toContain('R2')
  })

  test('an empty section is said empty; a modification names the living requirement', () => {
    const spec = written()
    const text = renderSpecMarkdown({
      ...spec,
      sections: spec.sections.map((section) =>
        section.name === 'impact' ? { ...section, body: '', version: 0 } : section,
      ),
      requirements: [
        { ...spec.requirements[0]!, delta: 'modified', livingRef: 'L-4', livingVersion: 2 },
      ],
    })
    expect(text).toContain('## Impact\n\n_Not written yet._')
    expect(text).toContain('### R1 · modified · invoices · L-4 at version 2')
  })
})

describe('The Spec language is a BCP 47 tag', () => {
  test('a tag is kept in its canonical spelling', () => {
    expect(canonicalLanguage('fr')).toBe('fr')
    expect(canonicalLanguage('en-gb')).toBe('en-GB')
    expect(canonicalLanguage(' pt-BR ')).toBe('pt-BR')
  })

  test('what is not a tag is refused', () => {
    expect(canonicalLanguage('')).toBeNull()
    expect(canonicalLanguage('not a tag')).toBeNull()
    expect(canonicalLanguage('en_US')).toBeNull()
  })
})

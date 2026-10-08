/**
 * The Probes (#89): the report a Probe ends with and the one rule that refuses it, the tools that
 * launch, read and end a Probe and the roles that hold them, and how a Probe and its report read.
 */

import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type ProbeReport,
  ROLES,
  TOOLS,
  probeLabel,
  probeNumberOf,
  probeReportRefusal,
  probeReportText,
  probeRunsSaid,
  toolsOf,
} from '../src/domain/index.ts'

const REPORT: ProbeReport = {
  outcome: 'reproduced',
  answer: 'The importer drops the accents of a name.',
  actions: [
    'Write tests/import-accents.test.ts',
    'Run pnpm vitest run tests/import-accents.test.ts',
  ],
  starting_data: 'A CSV with the name "Éloïse".',
  command: 'pnpm vitest run tests/import-accents.test.ts',
  expected: 'The name reads "Éloïse".',
  observed: 'Expected "Éloïse", received "Eloise"',
  key_line: 'Expected "Éloïse", received "Eloise"',
  test: { repository: 'api', path: 'tests/import-accents.test.ts', code: 'test(…)' },
  base_commit: 'abc1234',
  neighbours: [{ what: 'A cedilla', observed: '"Ç" becomes "C"', evidence: 'same command' }],
  evidence: ['import output'],
}

describe('A report is refused only for what it cannot be without', () => {
  test('reproduced without an observed output is refused, in the words the Probe reads', () => {
    const { observed: _left, ...without } = REPORT
    expect(probeReportRefusal(without)).toBe(
      'refused: a reproduced behaviour needs the observed output of a real run, quoted verbatim in `observed`',
    )
  })

  test('reproduced with an observed output of blanks only is refused the same way', () => {
    expect(probeReportRefusal({ ...REPORT, observed: '  \n ' })).toMatch(/^refused: a reproduced/)
  })

  test('reproduced with its output, and every other outcome without one, are kept', () => {
    const { observed: _left, ...without } = REPORT
    expect(probeReportRefusal(REPORT)).toBeNull()
    expect(probeReportRefusal({ ...without, outcome: 'not_reproduced' })).toBeNull()
    expect(probeReportRefusal({ ...without, outcome: 'answered' })).toBeNull()
    expect(probeReportRefusal({ ...without, outcome: 'inconclusive' })).toBeNull()
  })

  test('an outcome that is not one of the four does not read', () => {
    const read = Schema.decodeUnknownOption(TOOLS.probe_report.input)
    expect(Option.isNone(read({ ...REPORT, outcome: 'fixed' }))).toBe(true)
    expect(Option.isSome(read(REPORT))).toBe(true)
  })
})

describe('The Probe tools belong to the Planner and to the Probe alone', () => {
  test('the Planner launches and reads Probes; the Probe reports; nobody else has them', () => {
    const holders = (tool: 'probe_launch' | 'probe_read' | 'probe_report') =>
      ROLES.filter((role) => toolsOf(role).includes(tool))
    expect(holders('probe_launch')).toEqual(['planner'])
    expect(holders('probe_read')).toEqual(['planner'])
    expect(holders('probe_report')).toEqual(['probe'])
  })

  test('they are workflow tools: never judged, never a permission need', () => {
    expect(TOOLS.probe_launch.gate).toBe('workflow')
    expect(TOOLS.probe_read.gate).toBe('workflow')
    expect(TOOLS.probe_report.gate).toBe('workflow')
  })

  test('a Probe cannot launch a helper or another Probe (open question 16)', () => {
    expect(toolsOf('probe').filter((tool) => tool.endsWith('_launch'))).toEqual([])
  })
})

describe('How a Probe reads', () => {
  test('by its number, and in Now while it runs', () => {
    expect(probeLabel(85)).toBe('#85')
    expect(probeRunsSaid(85, 'does the importer keep accents?')).toBe(
      'Probe #85 runs: does the importer keep accents?',
    )
  })

  test('the Planner names one by `#3` or `3`, and nothing else', () => {
    expect(probeNumberOf('#3')).toBe(3)
    expect(probeNumberOf(' 3 ')).toBe(3)
    expect(probeNumberOf('#0')).toBeNull()
    expect(probeNumberOf('three')).toBeNull()
    expect(probeNumberOf('#3a')).toBeNull()
  })

  test('its report, as the Planner reads it, carries every part and the output verbatim', () => {
    const text = probeReportText(3, 'does the importer keep accents?', REPORT)
    expect(text.split('\n').slice(0, 3)).toEqual([
      'Probe #3: does the importer keep accents?',
      'Outcome: reproduced',
      'Answer: The importer drops the accents of a name.',
    ])
    expect(text).toContain('Observed (verbatim):\nExpected "Éloïse", received "Eloise"')
    expect(text).toContain('Key line: Expected "Éloïse", received "Eloise"')
    expect(text).toContain('Test: api/tests/import-accents.test.ts\ntest(…)')
    expect(text).toContain('- A cedilla: "Ç" becomes "C" (same command)')
    expect(text).toContain('Base commit: abc1234')
  })
})

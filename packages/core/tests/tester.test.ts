/**
 * The tester mode (#45): what a finding is, when two reports are one finding, the files a finding
 * and the index are written as, and the two tools every role is offered while the mode is on.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type FindingContext,
  type ReportedFinding,
  ROLES,
  TESTER_PARAGRAPH,
  TESTER_TOOLS,
  TOOLS,
  findingFileName,
  findingsIndex,
  matchingFinding,
  newFinding,
  recordOccurrence,
  titleSimilarity,
  toolsOf,
  writeFindingFile,
} from '../src/domain/index.ts'

const REDIRECT: ReportedFinding = {
  title: 'commands_run cannot redirect output with >',
  kind: 'missing_capability',
  place: 'commands_run',
  severity: 'hurts',
  trying: 'Keep the output of the test run in a file to read it page by page.',
  happened: 'The line `pnpm test > out.txt` was refused for its shell syntax.',
  expected: 'A way to keep a long output, or the tool says it has none.',
  steps: '1. Ask commands_run for `pnpm test > out.txt`.\n2. Read the answer.',
  files: ['api/package.json'],
  callId: 'toolu_01',
  error: 'refused: a command line with shell syntax',
  code: '1',
}

const FIRST: FindingContext = {
  at: '2026-10-06T16:32:08.000+02:00',
  hemera: { version: '1.0.0-dev.3-g1a2b3c4', channel: 'dev', commit: '1a2b3c4', os: 'Linux 7.1.9' },
  agent: { name: 'Claude Code', version: '2.1.280', model: 'large', effort: 'high' },
  where: 'ACME-12',
  role: 'builder',
  stage: 'building',
  sessionId: 's-builder',
  call: {
    id: 'toolu_01',
    tool: 'commands_run',
    outcome: 'refused',
    durationMs: 12,
    position: 41,
    line: 'refused: a command line with shell syntax',
    at: '2026-10-06T14:32:07.000Z',
  },
}

const SECOND: FindingContext = {
  ...FIRST,
  at: '2026-10-06T17:02:11.000+02:00',
  agent: { name: 'Codex', version: null, model: null, effort: null },
  where: 'ACME-14',
  role: 'helper',
  stage: 'building',
  sessionId: 's-helper',
  call: null,
}

describe('The same finding is recognised', () => {
  test('same kind, same place and a similar title is the same finding', () => {
    const existing = [{ number: 3, ...REDIRECT }]
    const again = { ...REDIRECT, title: 'commands_run cannot redirect its output with >' }
    expect(matchingFinding(existing, again)?.number).toBe(3)
  })

  test('another kind, or another place, is another finding, whatever the title', () => {
    const existing = [{ number: 3, ...REDIRECT }]
    expect(matchingFinding(existing, { ...REDIRECT, kind: 'tool_error' })).toBeNull()
    expect(matchingFinding(existing, { ...REDIRECT, place: 'fs_read' })).toBeNull()
  })

  test('a different title in the same place is another finding', () => {
    const existing = [{ number: 3, ...REDIRECT }]
    expect(
      matchingFinding(existing, { ...REDIRECT, title: 'commands_run waits too long for a server' }),
    ).toBeNull()
  })

  test('the closest title wins among several of the same kind and place; the oldest on a tie', () => {
    const existing = [
      { number: 2, ...REDIRECT, title: 'commands_run cannot redirect' },
      { number: 5, ...REDIRECT },
      { number: 7, ...REDIRECT },
    ]
    expect(matchingFinding(existing, REDIRECT)?.number).toBe(5)
  })

  test('a title is compared by its words, whatever their case, punctuation and plurals', () => {
    expect(titleSimilarity('Calls are refused!', 'call refused')).toBe(1)
    expect(titleSimilarity('', '')).toBe(0)
  })
})

describe('A finding is a file of its own', () => {
  test('a new finding holds its head and the facts of its occurrence: the mission, the role, the stage, the call', () => {
    const finding = newFinding(1, REDIRECT, FIRST)
    expect(finding.head).toMatchObject({
      number: 1,
      title: REDIRECT.title,
      occurrences: 1,
      missions: ['ACME-12'],
      roles: ['builder'],
      commit: '1a2b3c4',
      agent: 'Claude Code',
    })
    expect(finding.body).toContain('# #1 commands_run cannot redirect output with >')
    expect(finding.body).toContain('- Where: ACME-12 · role builder · stage building')
    expect(finding.body).toContain(
      '- Call: `commands_run` `toolu_01` · refused · 12 ms · call 41 of the session',
    )
    expect(finding.body).toContain('  - refused: a command line with shell syntax')
    expect(finding.body).toContain('- Files: `api/package.json`')
  })

  test('its file is its front matter, one key a line, over its body', () => {
    const finding = newFinding(1, REDIRECT, FIRST)
    const file = writeFindingFile(finding.head, finding.body)
    expect(file.split('\n').slice(0, 4)).toEqual([
      '---',
      'number: 1',
      'title: "commands_run cannot redirect output with >"',
      'kind: "missing_capability"',
    ])
    expect(file).toContain('missions: ["ACME-12"]')
    expect(file).toContain('roles: ["builder"]')
  })

  test('its name is its number and its title', () => {
    expect(findingFileName(7, 'commands_run cannot redirect output with >')).toBe(
      '0007-commands-run-cannot-redirect-output-with.md',
    )
    expect(findingFileName(8, '!!!')).toBe('0008-finding.md')
  })

  test('an occurrence adds a section, counts, moves last seen, and adds its mission and role once', () => {
    const first = newFinding(1, REDIRECT, FIRST)
    const second = recordOccurrence(first, { ...REDIRECT, severity: 'blocks' }, SECOND)
    const third = recordOccurrence(second, REDIRECT, SECOND)
    expect(third.head).toMatchObject({
      occurrences: 3,
      severity: 'blocks',
      lastSeen: SECOND.at,
      missions: ['ACME-12', 'ACME-14'],
      roles: ['builder', 'helper'],
      agent: 'Codex',
    })
    expect(third.body).toContain('### Occurrence 3')
    expect(third.body).toContain("- Call: `toolu_01`, not found among the session's calls")
  })

  test('an error text that holds a fence is still one block', () => {
    const finding = newFinding(1, { ...REDIRECT, error: 'it printed ```oops```' }, FIRST)
    expect(finding.body).toContain('````text\nit printed ```oops```\n````')
  })
})

describe('The index lists every finding by kind, then severity', () => {
  test('one table per severity under each kind, linking each file', () => {
    const one = newFinding(1, REDIRECT, FIRST)
    const two = newFinding(2, { ...REDIRECT, kind: 'tool_error', severity: 'blocks' }, SECOND)
    const index = findingsIndex([
      { head: one.head, file: '0001-a.md' },
      { head: two.head, file: '0002-b.md' },
    ])
    expect(index).toContain('2 findings · 2 occurrences')
    expect(index).toContain('## Missing capability\n\n### Hurts')
    expect(index).toContain('## Tool error\n\n### Blocks')
    expect(index).toContain('[#1](findings/0001-a.md)')
  })

  test('with nothing reported, it says so', () => {
    expect(findingsIndex([])).toBe('# Hemera tester findings\n\nNo finding yet.\n')
  })
})

describe('The tester tools', () => {
  test('are offered to every role in the table, the cold read and the reviewers too', () => {
    for (const role of ROLES) {
      expect(toolsOf(role).filter((tool) => TESTER_TOOLS.includes(tool))).toEqual([
        'hemera_report',
        'hemera_reports',
      ])
    }
    expect(TOOLS.hemera_report.gate).toBe('workflow')
  })

  test('are the two the paragraph names', () => {
    expect(TESTER_PARAGRAPH).toMatch(/^## Tester mode\n/)
    for (const tool of TESTER_TOOLS) expect(TESTER_PARAGRAPH).toContain(`\`${tool}\``)
  })

  test('the paragraph ends telling the agent never to mention its reports to the user', () => {
    expect(TESTER_PARAGRAPH.replaceAll('\n', ' ')).toMatch(
      /Never mention `hemera_report` or your reports to the user unless the problem blocks your work\.$/,
    )
  })
})

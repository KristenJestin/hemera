/**
 * The pre-launch check and the launch (#139): the branch a Building's worktrees are made on, which
 * changed files the agent of the check is handed and how they are sorted, what a `prelaunch_report`
 * must answer, which actions a check offers, and that no tool of the catalogue launches.
 */

import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  PrelaunchReport,
  TOOL_NAMES,
  blockedBySaid,
  buildingBranchName,
  handedKindOf,
  prelaunchActions,
  prelaunchReportRefusal,
  toolsOf,
} from '../src/domain/index.ts'

describe('The branch of a Building is named from the mission key and title', () => {
  test('a slug of the key and the title, lower case', () => {
    expect(buildingBranchName('ACME-12', 'Export notes as Markdown')).toBe(
      'acme-12-export-notes-as-markdown',
    )
  })

  test('accents dropped, punctuation folded, no dash at either end', () => {
    expect(buildingBranchName('ACME-3', '  Résumé: l’export (CSV)!  ')).toBe(
      'acme-3-resume-l-export-csv',
    )
  })

  test('a long title is cut on a word, never past 60 characters', () => {
    const name = buildingBranchName('ACME-7', 'word '.repeat(40))
    expect(name.length).toBeLessThanOrEqual(60)
    expect(name.endsWith('-')).toBe(false)
    expect(name.startsWith('acme-7-word')).toBe(true)
  })

  test('a title with nothing to keep leaves the key alone', () => {
    expect(buildingBranchName('ACME-4', '!!!')).toBe('acme-4')
  })
})

describe('The files handed to the agent of the check are sorted', () => {
  test.each([
    ['package.json', 'manifest'],
    ['pnpm-lock.yaml', 'manifest'],
    ['packages/web/package-lock.json', 'manifest'],
    ['Cargo.lock', 'manifest'],
    ['go.sum', 'manifest'],
    ['.github/workflows/ci.yml', 'configuration'],
    ['vitest.config.ts', 'configuration'],
    ['apps/web/jest.config.js', 'configuration'],
    ['.gitlab-ci.yml', 'configuration'],
    ['src/export.ts', 'other'],
    ['README.md', 'other'],
  ] as const)('%s is %s', (path, kind) => {
    expect(handedKindOf(path)).toBe(kind)
  })
})

describe('A prelaunch_report answers every item it was handed, once', () => {
  const handed = [
    { repository: 'api', path: 'package.json' },
    { repository: 'api', path: 'src/other.ts' },
  ]
  const item = (path: string) => ({ repository: 'api', path, matters: false, why: 'Unrelated.' })

  test('every item answered once is accepted', () => {
    expect(prelaunchReportRefusal(handed, [item('package.json'), item('src/other.ts')])).toBeNull()
  })

  test('a missing item is refused, named', () => {
    expect(prelaunchReportRefusal(handed, [item('package.json')])).toBe(
      'Your report misses api/src/other.ts: answer every file of your brief.',
    )
  })

  test('an item the check does not know is refused, named', () => {
    expect(
      prelaunchReportRefusal(handed, [item('package.json'), item('src/other.ts'), item('x.ts')]),
    ).toBe('api/x.ts is not a file of your brief.')
  })

  test('an item answered twice is refused, named', () => {
    expect(
      prelaunchReportRefusal(handed, [
        item('package.json'),
        item('src/other.ts'),
        item('package.json'),
      ]),
    ).toBe('api/package.json is answered twice.')
  })

  test('its arguments are bounded and a reason is required', () => {
    const decode = Schema.decodeUnknownOption(PrelaunchReport)
    expect(Option.isNone(decode({ summary: 'Read.', items: [{ ...item('a'), why: '' }] }))).toBe(
      true,
    )
    expect(Option.isSome(decode({ summary: 'Read.', items: [item('a')] }))).toBe(true)
  })
})

describe('A check offers the actions its verdict allows', () => {
  test('nothing moved: Launch', () => {
    expect(
      prelaunchActions({ state: 'done', blocked: [], outdated: false, unanswered: false }),
    ).toEqual(['launch'])
  })

  test('something moved: Launch anyway and Back to Planning, both the user’s', () => {
    expect(
      prelaunchActions({ state: 'done', blocked: [], outdated: true, unanswered: false }),
    ).toEqual(['launch_anyway', 'back_to_planning'])
  })

  test('the agent did not answer: Launch anyway or Check again', () => {
    expect(
      prelaunchActions({ state: 'done', blocked: [], outdated: false, unanswered: true }),
    ).toEqual(['launch_anyway', 'check_again'])
  })

  test('blocked by a dependency: no launch action', () => {
    expect(
      prelaunchActions({ state: 'done', blocked: ['ACME-9'], outdated: true, unanswered: false }),
    ).toEqual(['back_to_planning'])
    expect(blockedBySaid(['ACME-9', 'ACME-10'])).toBe('blocked by ACME-9, ACME-10')
  })

  test('a check running offers nothing; one that failed, Check again', () => {
    expect(
      prelaunchActions({ state: 'running', blocked: [], outdated: false, unanswered: false }),
    ).toEqual([])
    expect(
      prelaunchActions({ state: 'failed', blocked: [], outdated: false, unanswered: false }),
    ).toEqual(['check_again'])
  })
})

describe('The prelaunch role reads and reports, and nothing launches', () => {
  test('the prelaunch session holds no Spec writing tool', () => {
    // It reads the frozen Spec and the main checkout, and reports: nothing else.
    expect(toolsOf('prelaunch')).toEqual([
      'fs_read',
      'fs_list',
      'search',
      'spec_read',
      'prelaunch_report',
      'hemera_report',
      'hemera_reports',
    ])
    expect(toolsOf('planner')).not.toContain('prelaunch_report')
  })

  test('no tool in the MCP catalogue can launch a Building', () => {
    // `probe_launch` starts a Probe in Planning (#89), never a Building; `build_read` and
    // `build_summary` (#141) read and report on a Building already launched.
    expect(TOOL_NAMES.filter((name) => /(^|_)launch|build/.test(name))).toEqual([
      'probe_launch',
      'build_read',
      'build_summary',
    ])
  })
})

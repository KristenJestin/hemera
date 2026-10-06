/**
 * A session's brief: its marker, the role's fields with the empty ones left out, the Memory block
 * only for a role that reads the Memory, and the resume block of a replacement (CT-06).
 */

import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { openProfile } from '../src/engine/migrate.ts'
import { BriefSources, briefOf } from '../src/engine/sessions/brief.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string

beforeEach(async () => {
  data = temporaryFolder('session-brief')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const MISSION = { kind: 'mission', missionId: 'mission-1' } as const

const role = (readsMemory: boolean): RoleEntry => ({
  ...TEST_ROLE,
  readsMemory,
  brief: () =>
    Effect.succeed([
      { label: 'Your task', text: 'Export the invoices as CSV.' },
      { label: 'Constraints', text: null },
      { label: 'Checks', text: '   ' },
    ]),
})

/** The brief, its Memory read from a fixed block and a fixed last line. */
const briefed = (entry: RoleEntry, predecessor: Parameters<typeof briefOf>[2]) => {
  const asked: string[] = []
  const sources = Layer.succeed(BriefSources, {
    memoryBlock: (missionId) =>
      Effect.sync(() => {
        asked.push(`block ${missionId}`)
        return '## Now\n\nBuilding, round 1.'
      }),
    lastLine: (missionId, lineage) =>
      Effect.sync(() => {
        asked.push(`last ${missionId} ${lineage}`)
        return 'Ran pnpm --filter api test'
      }),
  })
  return on(data, briefOf(entry, MISSION, predecessor).pipe(Effect.provide(sources))).then(
    (text) => ({ text, asked }),
  )
}

describe('The brief', () => {
  test('it starts with its marker, holds the filled fields and leaves the empty ones out', async () => {
    const { text } = await briefed(role(true), null)
    expect(text.split('\n')[0]).toBe('[hemera:brief]')
    expect(text).toContain('## Your task\n\nExport the invoices as CSV.')
    expect(text).not.toContain('Constraints')
    expect(text).not.toContain('Checks')
    expect(text).not.toContain('none')
  })

  test('a role that reads the Memory gets its block after the fields', async () => {
    const { text, asked } = await briefed(role(true), null)
    expect(text).toMatch(/Export the invoices as CSV\.\n\n## Now\n\nBuilding, round 1\.$/)
    expect(asked).toEqual(['block mission-1'])
  })

  test('a role that does not read the Memory gets no Memory block', async () => {
    const { text, asked } = await briefed(role(false), null)
    expect(text).not.toContain('## Now')
    expect(asked).toEqual([])
  })
})

describe('The brief of a replacement', () => {
  const predecessor = { lineage: 'lineage-1', stoppedAt: '08:41' }

  test('a role that reads the Memory resumes from its last recorded action, checking the real state', async () => {
    const { text, asked } = await briefed(role(true), predecessor)
    expect(text).toContain(
      '[hemera:resume]\nYou replace a session that stopped at 08:41. Its last recorded action was: “Ran pnpm --filter api test”. Something may have happened after it without being recorded: check the real state before acting.',
    )
    expect(asked).toEqual(['block mission-1', 'last mission-1 lineage-1'])
  })

  test('a role that does not read the Memory starts again from the beginning, with no Journal', async () => {
    const { text, asked } = await briefed(role(false), predecessor)
    expect(text).toMatch(
      /\[hemera:resume\]\nA previous session stopped; start again from the beginning\.$/,
    )
    expect(text).not.toContain('## Now')
    expect(text).not.toContain('pnpm')
    expect(asked).toEqual([])
  })
})

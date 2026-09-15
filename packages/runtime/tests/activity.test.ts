import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_OUTPUT_BLOCKS,
  OutputNotAnEventError,
  appendOutput,
  openProfile,
  outputExtent,
  readJournal,
  readOutput,
  refuseOutputAsEvent,
} from '../src/index.ts'
import type { OpenProfile } from '../src/index.ts'

const NOW = 1_789_000_000_000

function withProfile(body: (profile: OpenProfile) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-activity-'))
  const profile = openProfile({ directory, now: NOW })
  try {
    body(profile)
  } finally {
    profile.database.close(true)
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Sortie volumineuse', () => {
  test('a long stream is read in blocks, in its own context, never whole', () => {
    withProfile((profile) => {
      for (let index = 0; index < 250; index += 1) {
        appendOutput(profile.database, {
          contextId: 'run-1',
          stream: 'stdout',
          content: `line ${index}\n`,
          recordedAt: NOW + index,
        })
      }

      let from: number | null = 0
      const seen: number[] = []
      let reads = 0
      while (from !== null) {
        const page: { blocks: { blockIndex: number }[]; nextBlockIndex: number | null } =
          readOutput(profile.database, 'run-1', from, 40)
        expect(page.blocks.length).toBeLessThanOrEqual(40)
        seen.push(...page.blocks.map((block) => block.blockIndex))
        from = page.nextBlockIndex
        reads += 1
      }
      expect(reads).toBe(7)
      expect(seen).toHaveLength(250)
      expect(new Set(seen).size).toBe(250)
    })
  })

  test('the journal keeps the business events while the output stays apart', () => {
    withProfile((profile) => {
      appendOutput(profile.database, {
        contextId: 'run-1',
        stream: 'stderr',
        content: 'a very long trace',
        recordedAt: NOW,
      })
      // Nothing of the output reached the journal.
      expect(readJournal(profile.database).events).toEqual([])
      expect(outputExtent(profile.database, 'run-1').recordedBlocks).toBe(1)
    })
  })

  test('output is never accepted as a journal event type', () => {
    expect(() => refuseOutputAsEvent('command.stdout')).toThrow(OutputNotAnEventError)
    expect(() => refuseOutputAsEvent('terminal.output')).toThrow(OutputNotAnEventError)
    expect(() => refuseOutputAsEvent('session.entry.recorded')).not.toThrow()
  })

  test('a read is bounded whatever is asked', () => {
    withProfile((profile) => {
      for (let index = 0; index < 5; index += 1) {
        appendOutput(profile.database, {
          contextId: 'run-1',
          stream: 'stdout',
          content: 'x',
          recordedAt: NOW,
        })
      }
      expect(readOutput(profile.database, 'run-1', 0, 10_000).blocks).toHaveLength(5)
      expect(MAX_OUTPUT_BLOCKS).toBeLessThan(10_000)
    })
  })

  test('two executions keep their output apart', () => {
    withProfile((profile) => {
      appendOutput(profile.database, {
        contextId: 'run-1',
        stream: 'stdout',
        content: 'one',
        recordedAt: NOW,
      })
      appendOutput(profile.database, {
        contextId: 'run-2',
        stream: 'stdout',
        content: 'two',
        recordedAt: NOW,
      })
      expect(readOutput(profile.database, 'run-1').blocks.map((block) => block.content)).toEqual([
        'one',
      ])
      expect(readOutput(profile.database, 'run-2').blocks.map((block) => block.content)).toEqual([
        'two',
      ])
    })
  })
})

describe('Portion non persistée', () => {
  test('what only reached the screen is never counted as recorded', () => {
    withProfile((profile) => {
      const streamed = ['first block', 'second block', 'third block that never lands']

      // The stream was interrupted after two blocks: only those two were recorded.
      for (const content of streamed.slice(0, 2)) {
        appendOutput(profile.database, {
          contextId: 'run-1',
          stream: 'stdout',
          content,
          recordedAt: NOW,
        })
      }

      const extent = outputExtent(profile.database, 'run-1')
      expect(extent.recordedBlocks).toBe(2)
      expect(extent.recordedCharacters).toBe(streamed[0]!.length + streamed[1]!.length)
      // The displayed stream is longer than what the store holds, and says so.
      const displayed = streamed.join('').length
      expect(extent.recordedCharacters).toBeLessThan(displayed)
    })
  })

  test('an execution with nothing recorded reports nothing recorded', () => {
    withProfile((profile) => {
      expect(outputExtent(profile.database, 'never-ran')).toEqual({
        recordedBlocks: 0,
        recordedCharacters: 0,
      })
      expect(readOutput(profile.database, 'never-ran').blocks).toEqual([])
    })
  })
})

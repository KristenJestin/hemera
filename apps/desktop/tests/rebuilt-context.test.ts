/**
 * The bounded context Hemera rebuilds for an agent that lost its session (D5-07), in a Session
 * whose turns carried a mission brief (D7-09).
 */

import { describe, expect, test } from 'vite-plus/test'

import type { SessionEntry } from '@hemera/core'
import { REBUILT_BYTES, rebuiltContext } from '#engine/agents/resume.ts'

let seq = 0

function entry(role: SessionEntry['role'], kind: SessionEntry['kind'], body: string): SessionEntry {
  seq += 1
  return {
    id: `entry-${seq}`,
    sessionId: 'session-1',
    seq,
    role,
    kind,
    body,
    payload: '{}',
    origin: 'live',
    correlationId: null,
    turnId: null,
    state: null,
    createdAt: seq,
  }
}

describe('The rebuilt context keeps the conversation, not the briefs', () => {
  test('mission briefs and proposals are left out, questions and answers stay', () => {
    // A brief is the whole Spec: two of them already fill the budget of the block.
    const brief = `# Mission: define\n${'x'.repeat(REBUILT_BYTES / 2)}`
    const thread = [
      entry('user', 'message', 'The Journal should export.'),
      entry('hemera', 'spec_proposal', 'Export the Journal'),
      ...Array.from({ length: 24 }, (_unused, turn) => [
        entry('hemera', 'mission_brief', brief),
        entry('user', 'message', `Turn ${turn}.`),
      ]).flat(),
      entry('hemera', 'spec_question', 'Which format?'),
      entry('user', 'spec_answer', 'CSV'),
    ]

    const block = rebuiltContext(thread)

    expect(block).not.toContain('# Mission: define')
    expect(block).not.toContain('Export the Journal')
    expect(block).toContain('User: Turn 23.')
    expect(block).toContain('Hemera: Which format?\nUser: CSV')
    // The budget is spent on what was said: twenty lines of the conversation, the last ones.
    expect(block).toContain('the last 20 entries of 27')
  })
})

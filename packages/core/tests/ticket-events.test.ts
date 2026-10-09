/**
 * Ticket events (#97): what changed between the last known version of a ticket and the one read
 * now, each change as one event, with the difference the user is shown; the sync interval's
 * bounds; and the two tools of the sync.
 */

import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  DEFAULT_SYNC_MINUTES,
  MIN_SYNC_MINUTES,
  TOOLS,
  type TicketComment,
  lineDifference,
  syncIntervalRefusal,
  ticketChanges,
  toolsOf,
} from '../src/domain/index.ts'

const comment = (id: string, body: string, fingerprint = body): TicketComment => ({
  id,
  author: 'grace',
  body,
  createdAt: '2026-10-01T09:00:00Z',
  editedAt: null,
  fingerprint,
})

const version = (
  over: Partial<{
    title: string
    description: string
    fingerprint: string
    status: { state: 'open' | 'closed'; wording: string }
    comments: ReadonlyArray<TicketComment>
  }> = {},
) => ({
  title: 'Export notes as Markdown',
  description: '## Why\nExports are slow.\n',
  fingerprint: 'f1',
  status: { state: 'open' as const, wording: 'open' },
  comments: [comment('IC_1', 'Keep the accents.')],
  ...over,
})

describe('Each kind of change gives the right event', () => {
  test('the same version gives none', () => {
    expect(ticketChanges(version(), version())).toEqual([])
  })

  test('a description whose fingerprint moved gives description_changed with the line difference, title included', () => {
    const changes = ticketChanges(
      version(),
      version({
        title: 'Export notes as Markdown and PDF',
        description: '## Why\nExports are slow and lossy.\n',
        fingerprint: 'f2',
      }),
    )
    expect(changes.map((one) => one.kind)).toEqual(['description_changed'])
    expect(changes[0]?.difference).toBe(
      [
        '- Export notes as Markdown',
        '+ Export notes as Markdown and PDF',
        '…',
        '- Exports are slow.',
        '+ Exports are slow and lossy.',
      ].join('\n'),
    )
  })

  test('a status that moved gives status_changed, before and after', () => {
    const changes = ticketChanges(
      version(),
      version({ status: { state: 'closed', wording: 'closed · not planned' } }),
    )
    expect(changes).toEqual([
      { kind: 'status_changed', commentId: null, difference: 'open → closed · not planned' },
    ])
  })

  test('a comment id not seen before gives comment_added, an edited body comment_edited, a missing one comment_removed', () => {
    const before = version({
      comments: [comment('IC_1', 'Keep the accents.'), comment('IC_2', 'Ship it as is.')],
    })
    const after = version({
      comments: [comment('IC_1', 'Keep the accents, and the emoji.'), comment('IC_3', 'CSV too?')],
    })
    expect(ticketChanges(before, after)).toEqual([
      {
        kind: 'comment_edited',
        commentId: 'IC_1',
        difference: '- Keep the accents.\n+ Keep the accents, and the emoji.',
      },
      { kind: 'comment_added', commentId: 'IC_3', difference: '+ CSV too?' },
      { kind: 'comment_removed', commentId: 'IC_2', difference: '- Ship it as is.' },
    ])
  })

  test('the changes come in a fixed order: description, status, then the comments', () => {
    const changes = ticketChanges(
      version(),
      version({
        description: 'Other.',
        fingerprint: 'f2',
        status: { state: 'closed', wording: 'closed' },
        comments: [comment('IC_1', 'Keep the accents.'), comment('IC_2', 'New.')],
      }),
    )
    expect(changes.map((one) => one.kind)).toEqual([
      'description_changed',
      'status_changed',
      'comment_added',
    ])
  })
})

describe('The line difference of normalised text', () => {
  test('only the lines that changed, a gap between two hunks', () => {
    expect(lineDifference('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE')).toBe('- b\n+ B\n…\n- e\n+ E')
  })

  test('line endings and trailing spaces are not a change', () => {
    expect(lineDifference('a  \r\nb', 'a\nb')).toBe('')
  })
})

describe('A difference too large to compare line by line', () => {
  const lines = (count: number, changed: number) =>
    Array.from({ length: count }, (_, at) => (at === changed ? 'changed' : `line ${String(at)}`))

  test('is the whole text removed, then the whole text added', () => {
    const before = lines(2000, -1)
    const after = lines(2000, 1000)
    const said = lineDifference(before.join('\n'), after.join('\n')).split('\n')
    expect(said).toEqual([
      ...before.map((line) => `- ${line}`),
      ...after.map((line) => `+ ${line}`),
    ])
  })

  test('two texts of twenty thousand lines are compared at once, without the table', () => {
    const said = lineDifference(lines(20_000, -1).join('\n'), lines(20_000, 7).join('\n'))
    expect(said.split('\n')).toHaveLength(40_000)
  })

  test('a text under the bound is still compared line by line', () => {
    expect(lineDifference(lines(1000, -1).join('\n'), lines(1000, 7).join('\n'))).toBe(
      '- line 7\n+ changed',
    )
  })
})

describe('The sync interval is a Project setting of at least five minutes', () => {
  test('one hour by default', () => {
    expect(DEFAULT_SYNC_MINUTES).toBe(60)
    expect(MIN_SYNC_MINUTES).toBe(5)
  })

  test.each([0, 4, 2.5, -60, 10_081])('%s minutes is refused', (minutes) => {
    expect(syncIntervalRefusal(minutes)).not.toBeNull()
  })

  test.each([5, 60, 1440])('%s minutes is kept', (minutes) => {
    expect(syncIntervalRefusal(minutes)).toBeNull()
  })
})

describe('The tools of the sync', () => {
  test('answer_propose is the Planner’s, a workflow tool', () => {
    expect(TOOLS.answer_propose.roles).toEqual(['planner'])
    expect(TOOLS.answer_propose.gate).toBe('workflow')
    expect(
      Schema.decodeUnknownSync(TOOLS.answer_propose.input)({
        question: 'Q2',
        source: 'IC_3',
        text: 'Comma.',
      }),
    ).toEqual({ question: 'Q2', source: 'IC_3', text: 'Comma.' })
  })

  test('ticket_event_report is the ticket-event session’s, and matters is yes, no or unsure', () => {
    expect(TOOLS.ticket_event_report.roles).toEqual(['ticket-event'])
    expect(TOOLS.ticket_event_report.gate).toBe('workflow')
    const decode = Schema.decodeUnknownSync(TOOLS.ticket_event_report.input)
    expect(() =>
      decode({ event: 'e1', summary: 'The CSV is asked too.', matters: 'maybe', why: 'x' }),
    ).toThrow()
  })

  test('the ticket-event session reads, reports, and writes nothing of the Spec', () => {
    const tools = toolsOf('ticket-event')
    expect(tools).toContain('spec_read')
    expect(tools).toContain('ticket_read')
    expect(tools).toContain('ticket_event_report')
    for (const writing of [
      'spec_write_section',
      'requirement_write',
      'requirement_remove',
      'proof_write',
      'tasks_write',
      'ask_wave',
      'answer_propose',
      'input_integrated',
      'declare_complete',
      'fs_write',
      'fs_edit',
      'commands_run',
    ]) {
      expect(tools).not.toContain(writing)
    }
  })

  test('input_integrated takes a ticket event id too', () => {
    const id = crypto.randomUUID()
    expect(Schema.decodeUnknownSync(TOOLS.input_integrated.input)({ id, where: 'why' }).id).toBe(id)
  })
})

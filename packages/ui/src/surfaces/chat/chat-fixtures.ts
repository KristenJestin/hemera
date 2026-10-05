import type { ChatItem } from '../../blocks/chat/chat-thread.tsx'

/**
 * The neutral conversation a story's Chat is drawn on: Acme's invoices, a few actions folded
 * under the agent's answers, a mention or two.
 */
export const CONVERSATION: readonly ChatItem[] = [
  {
    kind: 'message',
    id: 'm1',
    from: 'you',
    text: 'How are invoices exported today? Start from @api/src/routes/invoices.ts',
  },
  {
    kind: 'message',
    id: 'm2',
    from: 'agent',
    text: 'Invoices are exported by a single route, `GET /invoices/export`, which streams a CSV built row by row from the `invoices` table. The web app links to it from the list page; nothing else calls it.\n\nThe columns are fixed in the route itself, so adding one means changing the API, not a setting.',
    actions: [
      { id: 'a1', kind: 'read', label: 'api/src/routes/invoices.ts' },
      { id: 'a2', kind: 'search', label: 'export( in web/src' },
      { id: 'a3', kind: 'read', label: 'web/src/pages/invoices/list.tsx' },
    ],
  },
  {
    kind: 'message',
    id: 'm3',
    from: 'you',
    text: 'Could the export run the tests of the api first? Use @test',
  },
  {
    kind: 'message',
    id: 'm4',
    from: 'agent',
    text: 'It could, but the export is a read: running the tests before it would slow every download for no gain. The tests belong to the change that touches the route, not to the export.',
    actions: [
      { id: 'a4', kind: 'run', label: 'pnpm --filter api test' },
      { id: 'a5', kind: 'run', label: 'pnpm --filter api test -- invoices', failed: true },
    ],
  },
]

/** A conversation long enough to scroll, every answer with its actions. */
export const LONG_CONVERSATION: readonly ChatItem[] = Array.from({ length: 6 }, (_, round) =>
  CONVERSATION.map((item): ChatItem =>
    item.kind === 'message'
      ? {
          kind: 'message',
          id: `${item.id}-${String(round)}`,
          from: item.from,
          text: item.text,
          actions: item.actions,
        }
      : item,
  ),
).flat()

export const HELD_COMMAND = 'pnpm --filter api db:migrate'

export const LONG_COMMAND =
  'pnpm --filter api exec tsx scripts/backfill-invoice-numbers.ts --from 2024-01-01 --to 2026-10-01 --batch-size 500 --dry-run=false --report ./reports/backfill-invoice-numbers.json'

export const LONG_MESSAGE =
  'Here is everything I found about the export, file by file, with what each one does and what would have to change for the PDF format to sit beside the CSV one without a second route: the route builds the rows, the web page links to it, and the shared package holds the money formatting both of them use, which is the one piece that cannot be duplicated without the totals drifting apart over time.'

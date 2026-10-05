import type { Mentionable } from './mention-field.tsx'

/**
 * What a story's field can mention: files of Acme's main checkout, its missions, its commands. The
 * three most recent carry their rank.
 */
export const MENTIONABLES: readonly Mentionable[] = [
  { kind: 'file', id: 'f1', label: 'api/src/server.ts', recent: 1 },
  { kind: 'mission', id: 'm1', label: 'ACME-12', detail: 'Invoices export to CSV', recent: 2 },
  { kind: 'command', id: 'c1', label: 'test', detail: 'pnpm --filter api test', recent: 3 },
  { kind: 'file', id: 'f2', label: 'api/src/routes/invoices.ts' },
  { kind: 'file', id: 'f3', label: 'web/src/pages/invoices/list.tsx' },
  { kind: 'file', id: 'f4', label: 'shared/src/money.ts' },
  { kind: 'file', id: 'f5', label: 'api/package.json' },
  { kind: 'mission', id: 'm2', label: 'ACME-14', detail: 'Which table holds the invoices?' },
  { kind: 'mission', id: 'm3', label: 'ACME-15', detail: 'The shared package does not build' },
  { kind: 'command', id: 'c2', label: 'lint', detail: 'pnpm lint' },
  { kind: 'command', id: 'c3', label: 'dev', detail: 'pnpm --filter web dev' },
  {
    kind: 'file',
    id: 'f6',
    label:
      'web/src/features/billing/invoices/components/export-dialog/steps/choose-columns-and-format.tsx',
  },
]

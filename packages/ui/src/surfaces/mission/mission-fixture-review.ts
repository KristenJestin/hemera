import { type ReviewStageProps } from './review-stage.tsx'

/** A minute and a half ago, for the services that run. */
const AGO = Date.now() - 84_000

/** What the Review stage of ACME-12 shows: the data of its page, without its callbacks. */
export const REVIEW: Omit<
  ReviewStageProps,
  'onAddRemark' | 'onFix' | 'onOpenTask' | 'onService' | 'onOpenRound' | 'onOpenDiff' | 'chosenTask'
> = {
  remarks: [
    {
      id: 'F1',
      text: 'The date column follows the browser, not the customer.',
      state: 'addressed',
      round: 1,
    },
    {
      id: 'F2',
      text: 'The file name keeps the filters, but not the date range.',
      state: 'resolved',
      round: 1,
    },
    {
      id: 'F3',
      text: 'The empty state of the billing page lost its icon.',
      state: 'resolved',
      round: 1,
    },
    { id: 'F4', text: 'Two exports at once give the same file name.', state: 'inRound', round: 1 },
    { id: 'F5', text: 'A long export shows no progress at all.', state: 'pending' },
  ],
  nextRound: 2,
  requirements: [
    {
      id: 'R1',
      title: 'Export the invoices of the current filters as CSV',
      proven: true,
      tasks: [
        { id: 'T1', title: 'Add the export endpoint', state: 'done', repositories: ['api'] },
        { id: 'T2', title: 'Stream the rows', state: 'done', repositories: ['api'] },
        {
          id: 'T3',
          title: 'The export button on the billing page',
          state: 'done',
          repositories: ['web'],
        },
      ],
    },
    {
      id: 'R2',
      title: 'Name the file after the filters',
      proven: true,
      tasks: [{ id: 'T4', title: 'Build the file name', state: 'done', repositories: ['shared'] }],
    },
    {
      id: 'R3',
      title: 'Show a progress for long exports',
      proven: false,
      tasks: [
        { id: 'T5', title: 'Count the rows first', state: 'running', repositories: ['api'] },
        { id: 'T6', title: 'A progress on the button', state: 'todo', repositories: ['web'] },
      ],
    },
  ],
  proofs: [
    { id: 'S1', test: 'api/tests/invoices-export.test.ts', state: 'green' },
    { id: 'S2', test: 'web/e2e/billing-export.spec.ts', state: 'green' },
    { id: 'S3', test: 'api/tests/invoices-export-progress.test.ts', state: 'red' },
  ],
  services: [
    {
      name: 'api',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:3012',
      line: 'pnpm --filter api dev',
    },
    {
      name: 'web',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:4212',
      line: 'pnpm --filter web dev',
    },
  ],
  rounds: [{ n: 1, points: 4, state: 'closed' }],
  checks: [
    { repository: 'api', name: 'test', state: 'done', after: 'final' },
    { repository: 'api', name: 'typecheck', state: 'done', after: 'final' },
    { repository: 'web', name: 'test', state: 'done', after: 'final' },
    { repository: 'web', name: 'lint', state: 'failed', after: 'after R3' },
  ],
  changes: [
    { repository: 'api', files: 14, added: 412, deleted: 38 },
    { repository: 'web', files: 3, added: 96, deleted: 12, outside: true },
    { repository: 'shared', files: 1, added: 18, deleted: 0 },
  ],
}

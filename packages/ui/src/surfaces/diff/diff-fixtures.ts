import type { DiffComment, DiffFile, DiffMoment, DiffRepository } from './diff-types.ts'

/**
 * ACME-12 as the diff view reads it: the mission that exports invoices as CSV, across `api`,
 * `web` and `shared`. Neutral data, written to read like the change it stands for, so the diff is
 * judged on real code rather than on lorem ipsum. The comments carry the ids of the Review page's
 * remarks (#254): F4 and F8 are the same remarks there and here.
 */

const code = (...lines: readonly string[]): string => `${lines.join('\n')}\n`

/** A remark of 2,000 characters, the longest a field holds. */
const LONG_REMARK = [
  'The export button works on the first page of invoices, but as soon as I change the customer filter and come back to the list, the button keeps the old filter in its tooltip and the file it gives me holds the invoices of the previous customer.',
  'I tried it three times with Northwind and then Globex: each time the second export carried the first customer’s rows, and the file name said Globex while the rows said Northwind, which is the worst of both.',
  'Reloading the page fixes it, so it looks like the filters are read once when the page mounts and never again.',
  'While I was there: the progress on the button jumps from 0 to 100 on exports under a thousand rows, which reads as a glitch rather than as a progress — I would rather not show it at all below a second.',
  'The date column is right for Tokyo now, but the header still says “Date (UTC)” even when the dates are in the customer’s zone; it should name the zone it uses, or say nothing.',
  'Last, on a narrow window the button’s label wraps under its icon and pushes the table down by a line; the other buttons of the toolbar shrink to their icon instead, and this one should do the same.',
  'None of this blocks the merge for me except the first point, which exports the wrong customer’s invoices: please treat it first, and add a scenario that changes the filter twice before exporting.',
]
  .join(' ')
  .padEnd(2000, ' Again, the first point matters most.')
  .slice(0, 2000)

/** A path as deep as a real front end nests one. */
const LONG_PATH =
  'src/features/billing/invoices/export/components/export-button/export-progress-indicator.tsx'

/** A route of the billing API, as the controller holds a dozen of them. */
const route = (name: string, reader: string): readonly string[] => [
  `router.get('/invoices/:id/${name}', async (request, response) => {`,
  '  const invoice = await invoices.find(request.params.id)',
  '  if (invoice === null) {',
  '    response.status(404).end()',
  '    return',
  '  }',
  `  response.json(${reader}(invoice))`,
  '})',
  '',
]

const ROUTES = [
  ['summary', 'summaryOf'],
  ['lines', 'linesOf'],
  ['payments', 'paymentsOf'],
  ['credit', 'creditOf'],
  ['history', 'historyOf'],
  ['customer', 'customerOf'],
  ['taxes', 'taxesOf'],
  ['reminders', 'remindersOf'],
  ['pdf', 'pdfOf'],
] as const

const CONTROLLER_HEAD = [
  "import { Router } from 'express'",
  '',
  "import { invoices } from './invoices.ts'",
  "import { creditOf, customerOf, historyOf, linesOf, paymentsOf } from './readers.ts'",
  "import { pdfOf, remindersOf, summaryOf, taxesOf } from './readers.ts'",
  '',
  'export const router = Router()',
  '',
]

const CONTROLLER_BEFORE = code(
  ...CONTROLLER_HEAD,
  ...ROUTES.flatMap(([name, reader]) => route(name, reader)),
  "router.get('/invoices.csv', async (_request, response) => {",
  "  response.status(501).send('Not implemented')",
  '})',
)

const CONTROLLER_AFTER = code(
  ...CONTROLLER_HEAD.slice(0, 3),
  "import { exportInvoices } from './export.ts'",
  ...CONTROLLER_HEAD.slice(3),
  ...ROUTES.flatMap(([name, reader]) => route(name, reader)),
  "router.get('/invoices.csv', async (request, response) => {",
  '  const customer = String(request.query.customer ?? "")',
  '  const zone = String(request.query.zone ?? "UTC")',
  "  response.setHeader('Content-Type', 'text/csv; charset=utf-8')",
  '  response.setHeader(',
  "    'Content-Disposition',",
  '    `attachment; filename="${fileNameOf(customer)}"`,',
  '  )',
  '  await exportInvoices({ customer, zone }, response)',
  '})',
  '',
  'const fileNameOf = (customer: string): string =>',
  "  `acme-${customer.toLowerCase().replaceAll(' ', '-')}.csv`",
)

/** The columns the query reads, one helper each, as the module grew them. */
const COLUMN_HELPERS = [
  'amount',
  'currency',
  'customer',
  'dueAt',
  'issuedAt',
  'number',
  'paidAt',
  'status',
  'taxes',
].flatMap((name) => [
  `export function ${name}Column(table: Table) {`,
  `  return table.column('${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}')`,
  '}',
  '',
])

const QUERY_HEAD = [
  "import type { Table } from './db.ts'",
  "import { db } from './db.ts'",
  '',
  '/** The invoices of a customer, newest first. */',
  '',
]

const QUERY_BEFORE = code(
  ...QUERY_HEAD,
  ...COLUMN_HELPERS,
  'export function invoicesOf(customer: string) {',
  "  return db.select('*').from('invoices').where({ customer }).orderBy('issued_at', 'desc')",
  '}',
)

const QUERY_AFTER = code(
  ...QUERY_HEAD,
  ...COLUMN_HELPERS,
  'export function invoicesOf(customer: string) {',
  "  return db.select('*').from('invoices').where({ customer }).orderBy('issued_at', 'desc')",
  '}',
  '',
  '/** The invoices of an export, read in pages so a large customer never sits in memory. */',
  'export async function* invoicePages(customer: string, size = 500) {',
  '  let page = 0',
  '  for (;;) {',
  "    const rows = await db.select('*')",
  "      .from('invoices')",
  '      .where({ customer })',
  "      .orderBy('issued_at', 'desc')",
  '      .limit(size)',
  '      .offset(page * size)',
  '    if (rows.length === 0) return',
  '    yield rows',
  '    page += 1',
  '  }',
  '}',
)

const API_EXPORT = code(
  "import type { Writable } from 'node:stream'",
  '',
  "import { formatAmount } from '@acme/shared/money'",
  "import { inZone } from '@acme/shared/billing/time-zone'",
  "import { invoicePages } from './export.query.ts'",
  '',
  'export interface ExportRequest {',
  '  customer: string',
  '  zone: string',
  '}',
  '',
  'const HEADER = ["Number", "Issued", "Due", "Amount", "Currency", "Status"]',
  '',
  'const quoted = (value: string): string =>',
  '  /[",\\n]/.test(value) ? `"${value.replaceAll(\'"\', \'""\')}"` : value',
  '',
  'function lineOf(invoice: Invoice, zone: string): string {',
  '  return [',
  '    invoice.number,',
  '    inZone(invoice.issuedAt, zone),',
  '    inZone(invoice.dueAt, zone),',
  '    formatAmount(invoice.amount),',
  '    invoice.currency,',
  '    invoice.status,',
  '  ]',
  '    .map(quoted)',
  '    .join(",")',
  '}',
  '',
  '/**',
  ' * Writes the invoices of a customer as CSV, page by page: the first line is the header, even',
  ' * when the customer has no invoice, so the finance import always finds its columns.',
  ' */',
  'export async function exportInvoices(',
  '  { customer, zone }: ExportRequest,',
  '  out: Writable,',
  '): Promise<void> {',
  '  out.write(`${HEADER.join(",")} (${zone})\\n`)',
  '  for await (const page of invoicePages(customer)) {',
  '    for (const invoice of page) {',
  '      out.write(`${lineOf(invoice, zone)}\\n`)',
  '    }',
  '  }',
  '  out.end()',
  '}',
  '',
  'export const exportedColumns = HEADER.length',
)

const API_TEST = code(
  "import { describe, expect, test } from 'vitest'",
  '',
  "import { exportInvoices } from './export.ts'",
  "import { collect, seed } from './testing.ts'",
  '',
  "describe('Exporting invoices as CSV', () => {",
  "  test('a customer with no invoice still gets the header', async () => {",
  "    await seed({ customer: 'Northwind', invoices: [] })",
  "    const file = await collect((out) => exportInvoices({ customer: 'Northwind', zone: 'UTC' }, out))",
  "    expect(file).toBe('Number,Issued,Due,Amount,Currency,Status (UTC)\\n')",
  '  })',
  '',
  "  test('the dates are written in the customer’s zone', async () => {",
  "    await seed({ customer: 'Globex', invoices: [{ issuedAt: '2026-09-30T23:30:00Z' }] })",
  "    const file = await collect((out) => exportInvoices({ customer: 'Globex', zone: 'Asia/Tokyo' }, out))",
  "    expect(file).toContain('2026-10-01')",
  '  })',
  '})',
)

const MIGRATION = code(
  'CREATE TABLE invoice_exports (',
  '  id uuid PRIMARY KEY,',
  '  customer text NOT NULL,',
  '  zone text NOT NULL,',
  '  requested_at timestamptz NOT NULL DEFAULT now(),',
  '  finished_at timestamptz',
  ');',
  '',
  'CREATE INDEX invoice_exports_customer ON invoice_exports (customer, requested_at DESC);',
)

const WEB_EXPORT = code(
  "import { download } from './download.ts'",
  '',
  '/** Asks the API for the CSV of a customer and saves it under the name the API gives. */',
  'export async function exportCsv(customer: string, zone: string): Promise<void> {',
  '  const query = new URLSearchParams({ customer, zone })',
  '  const response = await fetch(`/api/invoices.csv?${query.toString()}`)',
  '  if (!response.ok) throw new Error(`The export failed: ${response.statusText}`)',
  '  await download(response)',
  '}',
)

const BUTTON_BEFORE = code(
  "import { Button } from '@acme/ui-kit'",
  "import { IconDownload } from './icons.tsx'",
  '',
  'interface ExportButtonProps {',
  '  customer: string',
  '}',
  '',
  'export function ExportButton({ customer }: ExportButtonProps) {',
  '  return (',
  '    <Button onClick={() => window.open(`/api/invoices.csv?customer=${customer}`)}>',
  '      <IconDownload />',
  '      Export',
  '    </Button>',
  '  )',
  '}',
)

const BUTTON_AFTER = code(
  "import { Button, IconDownload } from '@acme/ui-kit'",
  "import { useState } from 'react'",
  '',
  "import { exportCsv } from './export.ts'",
  "import { useCustomerFilter } from './filters.ts'",
  '',
  'interface ExportButtonProps {',
  '  zone: string',
  '}',
  '',
  'export function ExportButton({ zone }: ExportButtonProps) {',
  '  const customer = useCustomerFilter()',
  '  const [running, setRunning] = useState(false)',
  '  const run = async () => {',
  '    setRunning(true)',
  '    try {',
  '      await exportCsv(customer, zone)',
  '    } finally {',
  '      setRunning(false)',
  '    }',
  '  }',
  '  return (',
  '    <Button disabled={running} onClick={run}>',
  '      <IconDownload />',
  '      Export',
  '    </Button>',
  '  )',
  '}',
)

const ROW_HEAD = [
  "import { formatDate } from '@acme/shared/dates'",
  "import type { Invoice } from './types.ts'",
  '',
  'interface ExportRowProps {',
  '  invoice: Invoice',
  '  zone: string',
  '}',
  '',
  '/** One invoice in the preview of the export, as the CSV will write it. */',
  'export function ExportRow({ invoice, zone }: ExportRowProps) {',
  '  return (',
  '    <tr>',
  '      <td>{invoice.number}</td>',
  '      <td>{formatDate(invoice.issuedAt, zone)}</td>',
  '      <td>{formatDate(invoice.dueAt, zone)}</td>',
]

const ROW_BEFORE = code(
  ...ROW_HEAD,
  '      <td title="Amt">{amount(invoice.amount)}</td>',
  '      <td>{invoice.currency}</td>',
  '      <td>{invoice.status}</td>',
  '    </tr>',
  '  )',
  '}',
  '',
  'function amount(value: number): string {',
  '  return value.toFixed(2)',
  '}',
)

const ROW_AFTER = code(
  ...ROW_HEAD.slice(0, 1),
  "import { formatAmount } from '@acme/ui-kit'",
  ...ROW_HEAD.slice(1),
  '      <td title="Amount">{formatAmount(invoice.amount, invoice.currency)}</td>',
  '      <td>{invoice.currency}</td>',
  '      <td>',
  '        <InvoiceStatus status={invoice.status} />',
  '      </td>',
  '    </tr>',
  '  )',
  '}',
  '',
  '/** The status as the table of invoices draws it, so the preview and the list agree. */',
  "function InvoiceStatus({ status }: { status: Invoice['status'] }) {",
  '  return <span className={`status status-${status}`}>{status}</span>',
  '}',
)

const TABLE_BEFORE = code(
  "import { ExportRow } from './export-row.tsx'",
  "import type { Invoice } from './types.ts'",
  '',
  'export function InvoicesTable({ invoices }: { invoices: readonly Invoice[] }) {',
  '  return (',
  '    <table>',
  '      <tbody>',
  '        {invoices.map((invoice) => (',
  '          <ExportRow key={invoice.number} invoice={invoice} zone="UTC" />',
  '        ))}',
  '      </tbody>',
  '    </table>',
  '  )',
  '}',
)

const TABLE_AFTER = code(
  "import { ExportRow } from './export-row.tsx'",
  "import type { Invoice } from './types.ts'",
  '',
  'export function InvoiceTable({ invoices, zone }: { invoices: readonly Invoice[]; zone: string }) {',
  '  return (',
  '    <table>',
  '      <tbody>',
  '        {invoices.map((invoice) => (',
  '          <ExportRow key={invoice.number} invoice={invoice} zone={zone} />',
  '        ))}',
  '      </tbody>',
  '    </table>',
  '  )',
  '}',
)

const LEGACY_EXPORT = code(
  '/** The old export: a page of the admin that dumped every invoice. Replaced by ACME-12. */',
  'export function legacyExport(): void {',
  "  window.location.href = '/admin/invoices/dump'",
  '}',
)

const CLIENT_BEFORE = code(
  '// Generated by openapi-typescript from api/openapi.yaml. Do not edit.',
  '',
  'export interface paths {',
  "  '/invoices/{id}/summary': { get: operations['summary'] }",
  "  '/invoices/{id}/lines': { get: operations['lines'] }",
  '}',
)

const CLIENT_AFTER = code(
  '// Generated by openapi-typescript from api/openapi.yaml. Do not edit.',
  '',
  'export interface paths {',
  "  '/invoices/{id}/summary': { get: operations['summary'] }",
  "  '/invoices/{id}/lines': { get: operations['lines'] }",
  "  '/invoices.csv': { get: operations['exportInvoices'] }",
  '}',
  '',
  'export interface operations {',
  '  exportInvoices: {',
  '    parameters: { query: { customer: string; zone?: string } }',
  "    responses: { 200: { content: { 'text/csv': string } } }",
  '  }',
  '}',
)

const CHECK_BEFORE = code('../../tools/check-export.sh')

const CHECK_AFTER = code(
  '#!/bin/sh',
  '# Exports the fixture customer and compares the file with the expected one.',
  'set -eu',
  'curl -fsS "http://localhost:3012/invoices.csv?customer=Northwind" > /tmp/export.csv',
  'diff -u fixtures/northwind.csv /tmp/export.csv',
)

const NOTES = code(
  '# Export plan',
  '',
  '- The header names the zone the dates are written in.',
  '- Pages of 500 invoices, so the API never holds a large customer in memory.',
  '- The old admin dump goes away with this change.',
)

const ZONE_HEAD = [
  '/**',
  ' * Dates as a customer reads them: in their own time zone, written the way the finance team',
  ' * imports them.',
  ' */',
  '',
]

/** The time-zone helper as round 1 left it: F13 was written on its `toLocaleString` lines. */
const ZONE_BEFORE = code(
  ...ZONE_HEAD,
  'export function inZone(at: string, zone: string): string {',
  "  return new Date(at).toLocaleString('en-CA', { timeZone: zone }).slice(0, 10)",
  '}',
)

const ZONE_AFTER = code(
  ...ZONE_HEAD,
  'const formats = new Map<string, Intl.DateTimeFormat>()',
  '',
  '/** One formatter per zone, made once: an export of 400,000 invoices asks for the same few. */',
  'function formatOf(zone: string): Intl.DateTimeFormat {',
  '  const known = formats.get(zone)',
  '  if (known !== undefined) return known',
  "  const made = new Intl.DateTimeFormat('en-CA', {",
  '    timeZone: zone,',
  "    year: 'numeric',",
  "    month: '2-digit',",
  "    day: '2-digit',",
  '  })',
  '  formats.set(zone, made)',
  '  return made',
  '}',
  '',
  'export function inZone(at: string, zone: string): string {',
  '  return formatOf(zone).format(new Date(at))',
  '}',
)

const ZONE_TEST = code(
  "import { expect, test } from 'vitest'",
  '',
  "import { inZone } from './time-zone.ts'",
  '',
  "test('a date late in the evening in UTC is the next day in Tokyo', () => {",
  "  expect(inZone('2026-09-30T23:30:00Z', 'Asia/Tokyo')).toBe('2026-10-01')",
  '})',
)

const PACKAGE_BEFORE = code(
  '{',
  '  "name": "@acme/shared",',
  '  "exports": {',
  '    "./money": "./src/money.ts",',
  '    "./dates": "./src/dates.ts"',
  '  }',
  '}',
)

const PACKAGE_AFTER = code(
  '{',
  '  "name": "@acme/shared",',
  '  "exports": {',
  '    "./money": "./src/money.ts",',
  '    "./dates": "./src/dates.ts",',
  '    "./billing/time-zone": "./src/billing/time-zone.ts"',
  '  }',
  '}',
)

const CUSTOMERS = ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Tyrell']

/** The fixture of the export's tests: ten thousand invoices, one line each. */
export const LARGE_CSV = code(
  'number,customer,issued,due,amount,currency,status',
  ...Array.from({ length: 9_999 }, (_, at) => {
    const n = at + 1
    const customer = CUSTOMERS[n % CUSTOMERS.length] ?? 'Northwind'
    const day = String((n % 28) + 1).padStart(2, '0')
    const amount = ((n * 37) % 5_000) + 120
    const status = n % 9 === 0 ? 'overdue' : n % 3 === 0 ? 'open' : 'paid'
    return `ACME-INV-${String(n).padStart(5, '0')},${customer},2026-09-${day},2026-10-${day},${String(amount)}.00,EUR,${status}`
  }),
)

/**
 * A file with both its sides read, and the lines added and removed between them as Git counts
 * them for the tree. A binary or a withheld file has no sides; a large one waits for its Show.
 */
function counted({
  before: was,
  after: now,
  ...file
}: Omit<DiffFile, 'added' | 'removed' | 'sides'> & {
  before: string | null
  after: string | null
}): DiffFile {
  if (file.binary !== undefined || file.withheld === true) return { ...file, added: 0, removed: 0 }
  const before = new Set((was ?? '').split('\n'))
  const after = new Set((now ?? '').split('\n'))
  const added = (now ?? '').split('\n').filter((line) => !before.has(line)).length
  const removed = (was ?? '').split('\n').filter((line) => !after.has(line)).length
  const sides = { before: was, after: now }
  return file.large === undefined ? { ...file, added, removed, sides } : { ...file, added, removed }
}

/** The sides of the large file, given once its Show is pressed. */
export const LARGE_SIDES = { before: null, after: LARGE_CSV }

export const API: DiffRepository = {
  name: 'api',
  files: [
    counted({
      path: 'src/billing/export.controller.ts',
      letter: 'M',
      before: CONTROLLER_BEFORE,
      after: CONTROLLER_AFTER,
    }),
    counted({
      path: 'src/billing/export.query.ts',
      letter: 'M',
      before: QUERY_BEFORE,
      after: QUERY_AFTER,
    }),
    counted({ path: 'src/billing/export.ts', letter: 'A', before: null, after: API_EXPORT }),
    counted({ path: 'src/billing/export.test.ts', letter: 'A', before: null, after: API_TEST }),
    counted({
      path: 'db/migrations/0042_invoice_exports.sql',
      letter: 'A',
      before: null,
      after: MIGRATION,
    }),
    counted({
      path: '.env.local',
      letter: 'A',
      untracked: true,
      withheld: true,
      before: null,
      after: null,
    }),
  ],
}

export const WEB: DiffRepository = {
  name: 'web',
  files: [
    counted({ path: 'src/billing/export.ts', letter: 'A', before: null, after: WEB_EXPORT }),
    counted({
      path: 'src/billing/export-button.tsx',
      letter: 'M',
      before: BUTTON_BEFORE,
      after: BUTTON_AFTER,
    }),
    counted({
      path: 'src/billing/export-row.tsx',
      letter: 'M',
      before: ROW_BEFORE,
      after: ROW_AFTER,
    }),
    counted({
      path: 'src/billing/invoice-table.tsx',
      from: 'src/billing/invoices-table.tsx',
      letter: 'R',
      before: TABLE_BEFORE,
      after: TABLE_AFTER,
    }),
    counted({
      path: 'src/billing/legacy-export.ts',
      letter: 'D',
      before: LEGACY_EXPORT,
      after: null,
    }),
    counted({
      path: 'public/icons/download.png',
      letter: 'M',
      binary: { before: '1.2 KB', after: '1.6 KB' },
      before: null,
      after: null,
    }),
    counted({
      path: 'src/api/generated/client.ts',
      letter: 'M',
      generated: true,
      before: CLIENT_BEFORE,
      after: CLIENT_AFTER,
    }),
    counted({
      path: 'src/billing/fixtures/invoices.csv',
      letter: 'A',
      large: { lines: 10_000 },
      before: null,
      after: LARGE_CSV,
    }),
    counted({
      path: 'scripts/check-export.sh',
      letter: 'T',
      before: CHECK_BEFORE,
      after: CHECK_AFTER,
    }),
    counted({
      path: 'notes/export-plan.md',
      letter: 'A',
      untracked: true,
      before: null,
      after: NOTES,
    }),
  ],
}

export const SHARED: DiffRepository = {
  name: 'shared',
  files: [
    counted({
      path: 'src/billing/time-zone.ts',
      letter: 'M',
      before: ZONE_BEFORE,
      after: ZONE_AFTER,
    }),
    counted({ path: 'src/billing/time-zone.test.ts', letter: 'A', before: null, after: ZONE_TEST }),
    counted({ path: 'package.json', letter: 'M', before: PACKAGE_BEFORE, after: PACKAGE_AFTER }),
  ],
}

export const REPOSITORIES: readonly DiffRepository[] = [API, WEB, SHARED]

/** The line a piece of code stands on, in a file's content: the fixtures place comments by it. */
export function lineOf(content: string, piece: string, from = 1): number {
  const lines = content.split('\n')
  const at = lines.findIndex((line, index) => index + 1 >= from && line.includes(piece))
  if (at === -1) throw new Error(`"${piece}" is not in the file`)
  return at + 1
}

const one = (line: number) => ({ start: line, end: line })

const CONTROLLER_EXPORT = lineOf(CONTROLLER_AFTER, 'await exportInvoices')
const QUERY_STAR = lineOf(QUERY_AFTER, "const rows = await db.select('*')")
const EXPORT_HEADER = lineOf(API_EXPORT, 'out.write(`${HEADER')
const BUTTON_DISABLED = lineOf(BUTTON_AFTER, 'const [running')
const BUTTON_ICON = lineOf(BUTTON_AFTER, 'import { Button, IconDownload }')
const ROW_AMOUNT = lineOf(ROW_AFTER, 'formatAmount(invoice.amount')
const ROW_AMT = lineOf(ROW_BEFORE, 'title="Amt"')
const ZONE_FORMAT = lineOf(ZONE_AFTER, 'export function inZone')

/** Every state a comment can be in, on the lines it was written on. */
export const COMMENTS: readonly DiffComment[] = [
  {
    id: 'C1',
    kind: 'remark',
    text: 'This endpoint is not rate-limited. An export of everything, pressed in a loop, would hold a connection each.',
    state: 'waiting',
    place: {
      repository: 'api',
      path: 'src/billing/export.controller.ts',
      side: 'new',
      lines: one(CONTROLLER_EXPORT),
    },
    at: '08:58',
    team: {
      name: 'ana.lopez',
      forge: 'GitHub',
      url: 'https://github.com/acme/shop/pull/412#discussion_r1',
      resolved: false,
    },
  },
  {
    id: 'F8',
    kind: 'remark',
    text: 'This query reads every column; select only the ones the CSV writes.',
    state: 'waiting',
    place: {
      repository: 'api',
      path: 'src/billing/export.query.ts',
      side: 'new',
      lines: { start: QUERY_STAR, end: QUERY_STAR + 3 },
    },
    at: '09:47',
  },
  {
    id: 'F12',
    kind: 'remark',
    text: 'Keep the header row even when the customer has no invoice: the finance import needs its columns.',
    state: 'inRound',
    round: 2,
    place: {
      repository: 'api',
      path: 'src/billing/export.ts',
      side: 'new',
      lines: one(EXPORT_HEADER),
    },
    movedFrom: one(EXPORT_HEADER - 6),
    at: '09:52',
  },
  {
    id: 'F14',
    kind: 'question',
    text: 'Does this duplicate what shared already offers for downloads?',
    state: 'waiting',
    place: { repository: 'web', path: 'src/billing/export.ts', side: 'new', lines: null },
    at: '09:55',
  },
  {
    id: 'F1',
    kind: 'remark',
    text: 'The export button stays enabled while an export runs: two presses give two files.',
    state: 'addressed',
    round: 1,
    place: {
      repository: 'web',
      path: 'src/billing/export-button.tsx',
      side: 'new',
      lines: { start: BUTTON_DISABLED, end: BUTTON_DISABLED + 8 },
    },
    at: 'yesterday 16:10',
    thread: [
      {
        who: 'agent',
        text: 'The button is disabled from the press until the file is saved; a second press does nothing. Proven by S15.',
        at: 'yesterday 18:02',
      },
    ],
  },
  {
    id: 'C3',
    kind: 'remark',
    text: 'Nit: the icon should come from ui-kit.',
    state: 'resolved',
    place: {
      repository: 'web',
      path: 'src/billing/export-button.tsx',
      side: 'new',
      lines: one(BUTTON_ICON),
    },
    at: 'yesterday 17:40',
    team: {
      name: 'chen.wei',
      forge: 'GitHub',
      url: 'https://github.com/acme/shop/pull/413#discussion_r3',
      resolved: true,
    },
  },
  {
    id: 'F4',
    kind: 'remark',
    text: 'Use the amount formatter from ui-kit instead of a new one.',
    state: 'resolved',
    round: 1,
    place: {
      repository: 'web',
      path: 'src/billing/export-row.tsx',
      side: 'new',
      lines: one(ROW_AMOUNT),
    },
    at: 'yesterday 16:20',
    thread: [
      {
        who: 'agent',
        text: 'Replaced by `formatAmount` from ui-kit; the local helper is gone.',
        at: 'yesterday 18:02',
      },
    ],
  },
  {
    id: 'F5',
    kind: 'remark',
    text: 'Rename the column “Amt” to “Amount”.',
    state: 'withdrawn',
    round: 1,
    place: {
      repository: 'web',
      path: 'src/billing/export-row.tsx',
      side: 'old',
      lines: one(ROW_AMT),
    },
    at: 'yesterday 16:22',
  },
  {
    id: 'F13',
    kind: 'question',
    text: 'Why `toLocaleString` and a slice rather than a formatter made once?',
    state: 'addressed',
    round: 1,
    place: {
      repository: 'shared',
      path: 'src/billing/time-zone.ts',
      side: 'new',
      lines: { start: ZONE_FORMAT, end: ZONE_FORMAT + 2 },
    },
    outdated: {
      excerpt: code(
        'export function inZone(at: string, zone: string): string {',
        "  return new Date(at).toLocaleString('en-CA', { timeZone: zone }).slice(0, 10)",
        '}',
      ),
      version: 'round 1, yesterday 16:30',
    },
    at: 'yesterday 16:30',
    thread: [
      {
        who: 'agent',
        text: 'No good reason: it is a formatter per zone now, made once and kept, which an export of 400,000 invoices notices.',
        at: 'yesterday 18:02',
      },
    ],
  },
]

/** The diff of ACME-12 in Review, round 1 back: every comment state on its lines. */
export const REVIEWING: DiffMoment = {
  repositories: REPOSITORIES,
  comments: COMMENTS,
  source: { kind: 'live' },
}

/** web changed outside Hemera: someone edited the table in their own editor. */
export const OUTSIDE: DiffMoment = {
  ...REVIEWING,
  repositories: [
    API,
    {
      ...WEB,
      outside: true,
      files: WEB.files.map((file) =>
        file.path === 'src/billing/invoice-table.tsx' ? { ...file, outside: true } : file,
      ),
    },
    SHARED,
  ],
}

/** After Done, the Workspace cleaned up: the diff is read from the last checkpoint. */
export const CHECKPOINT: DiffMoment = {
  ...REVIEWING,
  source: { kind: 'checkpoint', at: '12 October at 17:02', why: 'cleanup' },
}

/** Nothing changed yet: the mission is in Building, before its first task wrote a line. */
export const EMPTY: DiffMoment = { repositories: [], comments: [], source: { kind: 'live' } }

/** The steps of round 2 writing `shared` while the user reads: each one more than the last. */
export const LIVE_STEPS: readonly DiffRepository[][] = [0, 1, 2, 3].map((step) => {
  const label = code(
    ...[
      "import { formatOf } from './time-zone.ts'",
      '',
      '/** The zone a header names: `Tokyo (UTC+09:00)`, as the finance import reads it. */',
      'export function zoneLabel(zone: string, at = new Date()): string {',
      "  const city = zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone",
      "  const offset = formatOf(zone).formatToParts(at).find((part) => part.type === 'timeZoneName')",
      '  return `${city} (${offset?.value ?? "UTC"})`',
      '}',
    ].slice(0, 2 + step * 2),
  )
  const files: DiffFile[] = [...SHARED.files]
  if (step > 0) {
    files.push(
      counted({ path: 'src/billing/zone-label.ts', letter: 'A', before: null, after: label }),
    )
  }
  return [API, WEB, { ...SHARED, files }]
})

/** Long text in every field: a long path, a 2,000-character comment, a 10,000-line file. */
export const LONG: DiffMoment = {
  ...REVIEWING,
  repositories: [
    API,
    {
      ...WEB,
      files: [
        counted({
          path: LONG_PATH,
          letter: 'A',
          before: null,
          after: code(
            "import { Progress } from '@acme/ui-kit'",
            '',
            '/** The progress of an export, shown only once it has run for a second. */',
            'export function ExportProgressIndicator({ done, total }: { done: number; total: number }) {',
            '  return <Progress value={done} max={total} label={`${String(done)} of ${String(total)} invoices`} />',
            '}',
          ),
        }),
        ...WEB.files,
      ],
    },
    SHARED,
  ],
  comments: [
    ...COMMENTS,
    {
      id: 'F10',
      kind: 'remark',
      text: LONG_REMARK,
      state: 'waiting',
      place: {
        repository: 'web',
        path: LONG_PATH,
        side: 'new',
        lines: { start: 4, end: 5 },
      },
      at: '09:58',
    },
  ],
}

/** The commented version of F13: the file as it was when the comment was written. */
export const F13_VERSION = { path: 'shared/src/billing/time-zone.ts', contents: ZONE_BEFORE }

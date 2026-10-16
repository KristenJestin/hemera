/**
 * Larkspur, the invented project the fixtures stand on: a small invoicing API and its web page,
 * two repositories in one main checkout, each with a README, code, tests that pass and one that
 * fails, several commits and a branch of work, and a bare repository on the same disk as its
 * remote. Nothing in it comes from a real person, company or domain.
 */

import { join } from 'node:path'

import { Effect } from 'effect'

import { createProject } from '../src/engine/projects.ts'
import { setVariable } from '../src/engine/variables.ts'
import type { FixtureGit } from './git.ts'

export const LARKSPUR = 'Larkspur'

/** A fake secret, plainly fake: no service would take it. */
export const FAKE_PAYMENTS_KEY = 'sk-fixture-4f1c9a7e-not-a-real-key'

/** The project's variables, its fake secret among them. */
export const LARKSPUR_VARIABLES = {
  API_BASE_URL: 'http://localhost:4010',
  LOG_LEVEL: 'debug',
  PAYMENTS_API_KEY: FAKE_PAYMENTS_KEY,
}

const API_PACKAGE = `{
  "name": "larkspur-api",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
`

const INVOICES = `/** The total of an invoice's lines, in cents. */
export function total(lines) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitCents, 0)
}

/** An amount in cents as the invoice prints it: 1234 is "12.34". */
export function formatAmount(cents) {
  return (cents / 100).toFixed(2)
}

/** A share of an amount, rounded to the cent. */
export function share(cents, ratio) {
  return Math.round(cents * ratio)
}
`

const INVOICES_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatAmount, total } from '../src/invoices.js'

test('an invoice totals its lines', () => {
  assert.equal(total([{ quantity: 2, unitCents: 450 }, { quantity: 1, unitCents: 1200 }]), 2100)
})

test('an amount prints with two decimals', () => {
  assert.equal(formatAmount(2100), '21.00')
})
`

/** A test that fails on main: the rounding asked for is not the one written. */
const ROUNDING_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

import { share } from '../src/invoices.js'

test('a share rounds half to even', () => {
  assert.equal(share(25, 0.5), 12)
})
`

const EXPORT_DRAFT = `import { formatAmount, total } from './invoices.js'

/** The invoices as CSV, one line each: its number and its total. */
export function toCsv(invoices) {
  const rows = invoices.map((invoice) => \`\${invoice.number},\${formatAmount(total(invoice.lines))}\`)
  return ['number,total', ...rows].join('\\n')
}
`

const WEB_PACKAGE = `{
  "name": "larkspur-web",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
`

const HEADER = `/** The page's header: the product's name and who is signed in. */
export function header(user) {
  return \`<header><h1>Larkspur</h1><span>\${user.name}</span></header>\`
}
`

const HEADER_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

import { header } from '../src/header.js'

test('the header names who is signed in', () => {
  assert.match(header({ name: 'Sam Example' }), /Sam Example/)
})
`

/** Larkspur's repositories on disk, under `work`; answers where each one is. */
export function larkspurOnDisk(work: string, git: FixtureGit) {
  const main = join(work, 'larkspur')
  const api = git.init(join(main, 'api'))
  git.commit(api, 'chore: start the invoicing api', {
    'README.md':
      '# Larkspur API\n\nInvoices for Larkspur: totals, amounts and shares.\n\n`npm test` runs the tests.\n',
    'package.json': API_PACKAGE,
    '.gitignore': 'node_modules/\n',
  })
  git.commit(api, 'feat: total an invoice and print its amount', {
    'src/invoices.js': INVOICES,
    'tests/invoices.test.js': INVOICES_TEST,
  })
  git.commit(api, 'test: round a share half to even', { 'tests/rounding.test.js': ROUNDING_TEST })
  git.run(api, 'switch', '-q', '-c', 'feature/csv-export')
  git.commit(api, 'feat: export the invoices as csv (draft)', { 'src/export.js': EXPORT_DRAFT })
  git.run(api, 'switch', '-q', 'main')

  const web = git.init(join(main, 'web'))
  git.commit(web, 'chore: start the web page', {
    'README.md':
      '# Larkspur web\n\nThe page that shows the invoices.\n\n`npm test` runs the tests.\n',
    'package.json': WEB_PACKAGE,
  })
  git.commit(web, 'feat: a header that names who is signed in', {
    'src/header.js': HEADER,
    'tests/header.test.js': HEADER_TEST,
  })
  git.commit(web, 'docs: say where the invoices come from', {
    'README.md':
      '# Larkspur web\n\nThe page that shows the invoices, read from the API at `API_BASE_URL`.\n\n`npm test` runs the tests.\n',
  })
  git.run(web, 'switch', '-q', '-c', 'fix/header-contrast')
  git.commit(web, 'fix: a header readable on the dark theme', {
    'src/header.css': 'header { color: #f5f5f5; background: #1d1d1f; }\n',
  })
  git.run(web, 'switch', '-q', 'main')

  const remotes = join(work, 'remotes')
  git.remote(api, join(remotes, 'larkspur-api.git'))
  git.remote(web, join(remotes, 'larkspur-web.git'))
  return { main, api, web }
}

/** Larkspur on disk, made a Project with its two repositories and its variables, as a user does. */
export const larkspur = (work: string, git: FixtureGit) =>
  Effect.gen(function* () {
    const onDisk = larkspurOnDisk(work, git)
    const project = yield* createProject({
      name: LARKSPUR,
      mainCheckout: onDisk.main,
      repositories: ['api', 'web'],
    })
    for (const [key, value] of Object.entries(LARKSPUR_VARIABLES)) {
      yield* setVariable({ projectId: project.id, workspaceId: null, key, value })
    }
    return { project, ...onDisk }
  })

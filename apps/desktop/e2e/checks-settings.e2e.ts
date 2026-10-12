/**
 * The checks and the doc recipes of a Project, from its settings in the real application (#152):
 * the checks proposed from the catalogue accepted, a free line with `|` refused in the engine's
 * words, a coverage check added, the doc recipes found in the main checkout accepted.
 * `checks-settings.restarted.e2e.ts` starts Hemera again on the same data folder and finds them.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import {
  checkbox,
  choose,
  designSize,
  dialog,
  field,
  section,
  settingsOf,
  write,
} from './settings-page.ts'

const SPEC = 'checks-settings.e2e.ts'

/** Under the temporary directory, removed by the headless run before and after it. */
const ACME = join(tmpdir(), 'hemera-e2e-checks-settings-work', 'acme')

/** Acme, a folder holding one repository, `api`, whose readme is in the main checkout. */
function writeAcme(): void {
  if (existsSync(ACME)) return
  const api = join(ACME, 'api')
  mkdirSync(api, { recursive: true })
  writeFileSync(join(api, 'README.md'), '# api\n')
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: api, stdio: 'ignore' },
    )
  git('init', '-q', '-b', 'main')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'base')
}

/** The list of the checks once read: while it is on its way, its skeleton rows wear its name. */
const checks = () => $('section[aria-label="Checks"]')

/** Adds a command of a type to the catalogue, used as a check. */
async function addCheckCommand(name: string, type: string, line: string): Promise<void> {
  await $('button=Add a command').click()
  const command = dialog()
  await write(field(command, 'Name'), name)
  await choose(command, 'Type', type)
  await write(field(command, 'Line'), line)
  await checkbox(command, 'Used as a check').click()
  await command.$('button=Add').click()
  await expect(command).not.toBeExisting()
}

describe('The checks and the doc recipes, from the settings of a Project', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('accept the proposed checks: lint after each task, build at the end', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    // Added from its folder, so that `api` is one of its repositories.
    await $('nav[aria-label="Places"]').$('button*=Add a Project').click()
    const adding = dialog()
    await write(field(adding, 'Folder'), ACME)
    await expect(adding.$('[data-found="api"]')).toBeDisplayed()
    await adding
      .$('label*=Let an agent propose the rest of the setup')
      .$('[role="checkbox"]')
      .click()
    await adding.$('button=Add acme').click()
    await expect(adding).not.toBeExisting()
    await settingsOf('acme')
    await section('Commands')
    await addCheckCommand('lint', 'Lint', 'node lint.mjs')
    await addCheckCommand('build', 'Build', 'node build.mjs')
    await section('Checks')
    await expect(checks()).toHaveText(expect.stringContaining('Nothing is kept until you accept'))
    await checks().$('button*=Accept all').click()
    await expect(checks().$('button[aria-label^="lint,"]')).toBeDisplayed()
    await expect(checks().$('button[aria-label^="build,"]')).toBeDisplayed()
    await expect(checks()).not.toHaveText(expect.stringContaining('Nothing is kept'))
  })

  it('add a free line with | and read the refusal', async () => {
    await checks().$('button*=Add a check').click()
    const adding = dialog()
    await write(field(adding, 'Name'), 'unit')
    await write(field(adding, 'Line'), 'node test.mjs | tee out.txt')
    await expect(adding).toHaveText(expect.stringContaining('“|”'))
    await adding.$('button=Add').click()
    await expect(adding).toBeDisplayed()
    await expect(adding).toHaveText(expect.stringContaining('“|”'))
  })

  it('add a coverage check: a number in its output, at least 70', async () => {
    const adding = dialog()
    await write(field(adding, 'Name'), 'coverage')
    await write(field(adding, 'Line'), 'node coverage.mjs')
    await choose(adding, 'Expects', 'A number in its output')
    await write(field(adding, 'Pattern'), 'Coverage: ([0-9.]+)%')
    await write(field(adding, 'At least'), '70')
    await adding.$('button=Add').click()
    await expect(adding).not.toBeExisting()
    await expect(checks().$('button[aria-label^="coverage,"]')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('expects a number of at least 70'),
    )
  })

  it('accept the proposed doc recipes: the readme of api', async () => {
    await section('Documentation')
    const documentation = $('section[aria-label="Documentation"]')
    await expect(documentation).toHaveText(expect.stringContaining('README.md'))
    await documentation.$('button*=Accept all').click()
    await expect(documentation.$('button[aria-label^="README.md in api"]')).toBeDisplayed()
  })
})

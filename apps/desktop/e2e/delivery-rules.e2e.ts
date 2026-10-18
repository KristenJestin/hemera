/**
 * The delivery rules of a Project, from its settings in the real application (#465): Acme added
 * with three repositories, a preset set and one step overridden, an inconsistent rule refused with
 * its reason and mended, and the forge's command line signed out, then ready after Check again.
 * `delivery-rules.restarted.e2e.ts` starts Hemera again on the same data folder and finds the
 * rules unchanged.
 *
 * `gh` is a fake on the `PATH` the launcher gives the application (`fake-gh.ts`): signed out until
 * the spec writes the file that signs it in. A shell script, so the suite is skipped on Windows.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { GH_SIGNED_IN_BY_FILE, RUNS_FAKE_GH, writeFakeGh } from './fake-gh.ts'
import { choose, designSize, dialog, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'delivery-rules.e2e.ts'

/** Under the temporary directory, removed by the headless run before and after it. */
const ACME = join(tmpdir(), 'hemera-e2e-delivery-rules-work', 'acme')

const ghFolder = writeFakeGh(SPEC, GH_SIGNED_IN_BY_FILE)

/** Runs the machine's own `git`, with a plain, unsigned identity whatever its configuration. */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )
}

/**
 * Acme: `api` and `web` on GitHub (their remotes are only read, never fetched), and `shared` with
 * no remote, which delivers on this machine.
 */
function writeAcme(): void {
  if (existsSync(ACME)) return
  for (const path of ['api', 'web', 'shared']) {
    const folder = join(ACME, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    if (path !== 'shared') {
      git(folder, 'remote', 'add', 'origin', `https://github.com/acme/${path}.git`)
    }
  }
}

const rules = () => $('section[aria-label="Delivery rules"]')

/** A repository's line, by its path: its words start with it. */
const line = (path: string) => rules().$(`button[aria-label^="${path}, "]`)

/** A step of a repository's recipe, by the words its line starts with. */
const step = (list: string, words: string) =>
  rules().$(`ul[aria-label="${list}"]`).$(`button[aria-label^="${words}"]`)

const describeWithFake = RUNS_FAKE_GH ? describe : describe.skip

describeWithFake('The delivery rules, from the settings of a Project', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('add Acme with three repositories and read their presets', async () => {
    writeAcme()
    await waitForEngine()
    await designSize()
    // Added from its folder, so that the three repositories are the Project's: the probe's
    // `createProject` adds a Project with none.
    await $('nav[aria-label="Places"]').$('button*=Add a Project').click()
    const adding = dialog()
    await write(field(adding, 'Folder'), ACME)
    await Promise.all(
      ['api', 'web', 'shared'].map((path) =>
        expect(adding.$(`[data-found="${path}"]`)).toBeDisplayed(),
      ),
    )
    await adding
      .$('label*=Let an agent propose the rest of the setup')
      .$('[role="checkbox"]')
      .click()
    await adding.$('button=Add acme').click()
    await expect(adding).not.toBeExisting()
    await settingsOf('acme')
    await section('Delivery rules')
    await expect(line('api')).toHaveAttribute('aria-label', expect.stringContaining('Application'))
    await expect(line('web')).toHaveAttribute('aria-label', expect.stringContaining('Application'))
    // No remote, no forge read: the engine's default is Application until a preset is chosen.
    await expect(line('shared')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Application'),
    )
  })

  it('set the presets and override one step', async () => {
    await line('api').click()
    await choose(rules(), 'Preset of api', 'Library')
    await expect(line('api')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^api, Library, as the preset/),
    )
    await line('shared').click()
    await choose(rules(), 'Preset of shared', 'Local')
    await expect(line('shared')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^shared, Local, as the preset/),
    )
    await expect(step('Steps of shared', 'Merge locally,')).toBeDisplayed()
    await step('Steps of api', 'CI,').click()
    const ci = dialog()
    await choose(ci, 'Starts', 'Waits for your click')
    await ci.$('button=Save').click()
    await expect(ci).not.toBeExisting()
    await expect(step('Steps of api', 'CI,')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('changed here, waits for your click'),
    )
    await expect(line('api')).toHaveAttribute('aria-label', expect.stringContaining('1 change'))
  })

  it('try an inconsistent rule: refused with its reason, then mended', async () => {
    await line('web').click()
    await step('Steps of web in Review', 'Push,').click()
    const push = dialog()
    await push.$('button*=Leave out Push in web').click()
    await expect(push).not.toBeExisting()
    const refused = rules().$('ul[aria-label="Steps of web in Review"]').$('[role="alert"]')
    await expect(refused).toHaveText(expect.stringContaining('A pull request needs a push'))
    await expect(
      $('nav[aria-label="Settings of the Project"]').$(
        'button[aria-label="Delivery rules, rules refused"]',
      ),
    ).toBeDisplayed()
    await rules().$('button[aria-label="Put back Push"]').click()
    await expect(refused).not.toBeExisting()
    await expect(line('web')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^web, Application, as the preset/),
    )
  })

  it('read the forge’s command line signed out, then ready after Check again', async () => {
    const trouble = rules().$('[data-repository="api"]')
    await expect(trouble).toHaveText(expect.stringContaining('gh auth login --hostname github.com'))
    writeFileSync(join(ghFolder, 'signed-in'), '')
    await trouble.$('button*=Check again').click()
    await expect(trouble).not.toHaveText(expect.stringContaining('gh auth login'))
    await expect(line('api')).toHaveAttribute('aria-label', expect.stringContaining('gh is ready'))
  })
})

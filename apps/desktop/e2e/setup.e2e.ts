/**
 * A first launch and a new Project's setup in the real application (#53), with the headless
 * suite's agent as the setup agent: the first launch with no Project, its empty state and the two
 * ways in; Acme added from a folder that is not a repository and holds one Hemera does not
 * find; the setup agent's card for it, which Accept all declares; a command added to Never run,
 * which the agent is then refused in a Chat; and the cap set to one, which
 * `setup.restarted.e2e.ts` finds again after Hemera starts anew.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { designSize, dialog, field, section, settingsOf, write } from './settings-page.ts'

const SPEC = 'setup.e2e.ts'
/** Acme: not a repository, holding `services/web`, a level deeper than Hemera looks. */
const ACME = join(tmpdir(), 'hemera-e2e-setup-work', 'acme')

const places = () => $('nav[aria-label="Places"]')
const conversation = () => $('ol[aria-label="Conversation"]')

function repository(path: string): void {
  mkdirSync(path, { recursive: true })
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['commit', '-q', '--allow-empty', '-m', 'base'],
  ]) {
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: path, stdio: 'ignore' },
    )
  }
}

/** The setup agent reads the Project, then proposes the repository nobody declared. */
const PROPOSES = {
  steps: [
    { does: 'uses', id: 'toolu_read', tool: 'setup_read', arguments: {} },
    {
      does: 'uses',
      id: 'toolu_propose',
      tool: 'setup_propose',
      arguments: { changes: [{ kind: 'repository', path: 'services/web', baseBranch: 'main' }] },
    },
    { does: 'says', text: 'I proposed the setup.' },
  ],
} as const

/** In a Chat, the agent runs the command the Project never runs. */
const RUNS_REFUSED = {
  steps: [
    {
      does: 'uses',
      id: 'toolu_apply',
      tool: 'commands_run',
      arguments: { line: 'terraform apply' },
    },
    { does: 'says', text: 'It was refused.' },
  ],
} as const

describe('A first launch, and a new Project set up by its agent', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens on the first launch: the empty state and the two ways in', async () => {
    repository(join(ACME, 'services', 'web'))
    await waitForEngine()
    await designSize()
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      PROPOSES,
    )
    await expect($('main')).toHaveText(expect.stringContaining('No Project yet'))
    await expect($('button*=Add a Project folder')).toBeDisplayed()
    await expect($('button*=Create a new Project')).toBeDisplayed()
  })

  it('adds Acme from its folder with the setup chosen, and its task shows the agent’s card', async () => {
    await $('button*=Add a Project folder').click()
    const adding = dialog()
    await write(field(adding, 'Folder'), ACME)
    // Hemera has looked in the folder, the rest grown in: nothing found where it looks.
    await expect(adding).toHaveText(expect.stringContaining('None in this folder'))
    // The setup is the user's choice, offered with the agent the setup role runs on.
    await adding.$('aria/Let an agent propose the rest of the setup').click()
    await adding.$('button=Add acme').waitForClickable()
    await adding.$('button=Add acme').click()
    await expect(adding).not.toBeExisting()
    // The Project's page, its setup a task of it.
    await expect($('main h1')).toHaveText('acme', { containing: true })
    const task = $('[role="region"][aria-label="Tasks"]')
    // The chip wears the dot of what waits; its menu asks for the review, in its details.
    await task.$('aria/Setup agent, done, waits for you').click()
    await $('button=Review 1 proposal').click()
    await expect($('[role="dialog"]*=Setup of acme')).toBeDisplayed()
    const card = $('[data-setup-card="repositories"]')
    await expect(card).toHaveText(expect.stringContaining('services/web'))
    await expect(card).toHaveAttribute('data-card-state', 'proposed')
  })

  it('declares the repository with Accept all; the task leaves, the setup stays to launch', async () => {
    await $('button*=Accept all').click()
    // Every proposal answered: the task leaves the Project's page.
    await expect($('[role="region"][aria-label="Tasks"]')).not.toBeExisting()
    await settingsOf('acme')
    await expect($('[data-repository="services/web"]')).toBeDisplayed()
    // It can be launched again from the settings, at any time.
    await expect($('button=Set up with an agent')).toBeDisplayed()
  })

  it('adds a command to Never run', async () => {
    await section('Commands')
    await $('button*=Refuse a command').click()
    const never = dialog()
    await write(field(never, 'Command'), 'terraform apply')
    await never.$('button=Add').click()
    await expect(never).not.toBeExisting()
    await expect($('ul[aria-label="Never run"]')).toHaveText(
      expect.stringContaining('terraform apply'),
    )
  })

  it('sets the cap to one sub-agent, read back from the engine', async () => {
    await section('Cap and budget')
    await write($('aria/Sub-agents at once'), '1')
    // Written once the typing settles: the section reads it again each time it comes back.
    await browser.waitUntil(
      async () => {
        await section('Commands')
        await section('Cap and budget')
        return (await $('aria/Sub-agents at once').getValue()) === '1'
      },
      { timeoutMsg: 'the cap was never read back as one' },
    )
  })

  it('refuses the agent that command in a Chat, without asking', async () => {
    await browser.electron.execute(
      async (_, script) => await globalThis.hemeraProbe?.scriptAgent(script),
      RUNS_REFUSED,
    )
    await places().$('button[aria-label="Open the missions of acme"]').click()
    await places().$('button*=New Chat').click()
    const message = $('[role="textbox"][aria-label="Message"]')
    await message.click()
    await message.addValue('Apply the infrastructure.')
    await $('button[aria-label="Send"]').click()
    await expect(conversation()).toHaveText(expect.stringContaining('It was refused.'))
    await conversation().$('button*=1 action').click()
    await expect(conversation().$('[aria-label="Failed"]')).toBeDisplayed()
    await expect($('section[aria-label*="asks to"]')).not.toBeExisting()
  })
})

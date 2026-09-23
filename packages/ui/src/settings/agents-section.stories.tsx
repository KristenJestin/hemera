import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AgentsSection } from './agents-section.tsx'

/**
 * The three answers this machine can give about an agent, drawn in the shape of the other
 * settings sections: what is installed, whether it is up to date, and the one press that moves
 * it.
 *
 * Every story keeps the same three agents so that the section reads the way a reader would find
 * it: Claude Code found with an update waiting, Codex installed but not signed in and not
 * available here, OpenCode absent with the one command that would get it.
 */
const CLAUDE = {
  id: 'claude',
  name: 'Claude Code',
  found: true,
  version: '2.0.31',
  authenticated: true,
  installHint: 'npm i -g @anthropic-ai/claude-code',
  loginHint: 'claude auth login',
  installer: 'npm',
  latest: '2.0.35',
  bare: {
    qualified: true,
    private:
      'its managed and policy settings and ~/.claude.json still load; Hemera does not read them.',
  },
} as const

const CODEX = {
  id: 'codex',
  name: 'Codex',
  found: true,
  version: '0.9.4',
  authenticated: false,
  installHint: 'npm i -g @openai/codex',
  loginHint: 'codex login',
  installer: 'pnpm',
  latest: '0.9.4',
  bare: {
    qualified: false,
    reason:
      'apply_patch has no configuration key, and the MCP resource tools appear as soon as an MCP server exists. Hemera would not see those calls, so this Session is not opened.',
  },
} as const

const OPENCODE = {
  id: 'opencode',
  name: 'OpenCode',
  found: false,
  version: null,
  authenticated: false,
  installHint: 'npm i -g opencode-ai',
  loginHint: 'opencode auth login',
  installer: 'unknown',
  latest: null,
  bare: {
    qualified: true,
    private:
      '$HOME/.opencode, its managed configuration and a remote .well-known/opencode still load; Hemera does not read them.',
  },
} as const

/** What an installer says when it has moved a package, kept as the tool wrote it. */
const SAID = `added 1 package in 4s

+ @anthropic-ai/claude-code@2.0.35
updated 1 package and audited 2 packages in 3.812s`

const meta = {
  title: 'Surfaces/Settings/Agents',
  component: AgentsSection,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    agents: [CLAUDE, CODEX, OPENCODE],
    checked: true,
    updating: null,
    output: {},
    onUpdate: fn(),
  },
  argTypes: {
    agents: { control: 'object', description: 'What this machine says about each agent.' },
    checked: { control: 'boolean', description: 'Whether the registries answered this visit.' },
    updating: { control: 'text', description: 'The agent being updated, or null.' },
    output: { control: 'object', description: 'What each tool last said, in its own words.' },
    onUpdate: { control: false, description: 'Asks the tool to move the agent.' },
  },
} satisfies Meta<typeof AgentsSection>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing is picked for the reader, and a missing agent is not replaced by another. */
export const FoundNotInstalledAndNotSignedIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/nothing is picked for you/)).toBeVisible()
    await expect(canvas.getByText('Found')).toBeVisible()
    await expect(canvas.getByText('Not installed')).toBeVisible()
    await expect(canvas.getByText('Not signed in')).toBeVisible()
    await expect(canvas.queryByText('no version reported')).not.toBeInTheDocument()
  },
}

/**
 * One line for the one question a version raises, and the one agent whose registry answered
 * something newer.
 *
 * Claude Code is found at 2.0.31 and its registry published 2.0.35, so it is the only one
 * offered an update; Codex is on the version it published, so nothing is offered for it. What
 * was published, and which tool installed either of them, are not rows of their own.
 */
export const UpdateAvailable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2.0.31')).toBeVisible()
    await expect(canvas.getByText('Update available 2.0.35')).toBeVisible()
    await expect(canvas.getByText('Up to date')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /update to 2\.0\.35/i })).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: /update to/i })).toHaveLength(1)
    const gone = ['Published', 'Installed with', 'Bare mode'].filter(
      (label) => canvas.queryByText(label) !== null,
    )
    await expect(gone).toEqual([])
  },
}

/**
 * Newer published, and nothing here can say which tool installed the command: the line says so,
 * and no button is offered, because an update run with the wrong tool is a second installation.
 */
export const UpdateAvailableWithNoKnownInstaller: Story = {
  args: { agents: [{ ...CLAUDE, installer: 'unknown' }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Update available 2.0.35')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
  },
}

/** The update runs the tool that installed the command, and only because a button was pressed. */
export const TheUpdateRunsOnAPress: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /update to 2\.0\.35/i }))
    await expect(args.onUpdate).toHaveBeenCalledWith('claude')
  },
}

/** An agent already on what its registry published says so, and is offered nothing at all. */
export const UpToDate: Story = {
  args: { agents: [{ ...CLAUDE, version: '2.0.35' }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Up to date')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
    await expect(canvas.getAllByText('2.0.35')).toHaveLength(1)
  },
}

/** An agent that is missing says how to get it, rather than being silently absent. */
export const MissingSaysHowToGetIt: Story = {
  args: { agents: [OPENCODE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('not on this machine')).toBeVisible()
    await expect(canvas.getByText('npm i -g opencode-ai')).toBeVisible()
    // Nothing is installed, so there is no version to compare and no line about updates.
    await expect(canvas.queryByText('Updates')).not.toBeInTheDocument()
    await expect(canvas.queryByText('unknown')).not.toBeInTheDocument()
  },
}

/** Installed and not signed in, which is the reader's to fix and nobody else's. */
export const InstalledButNotSignedIn: Story = {
  args: { agents: [CODEX] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not signed in')).toBeVisible()
    // The one command that would fix it, in the agent's own words (D5-21).
    await expect(canvas.getByText('codex login')).toBeVisible()
    // The version it is on, and the one line that says nothing newer was published.
    await expect(canvas.getByText('0.9.4')).toBeVisible()
    await expect(canvas.getByText('Up to date')).toBeVisible()
  },
}

/**
 * The agent and never the adapter behind it: the names and the commands the reader is handed are
 * the agent's own, and the package Hemera spawns on its behalf is named nowhere (D5-21).
 */
export const NamesTheAgentAndNotItsAdapter: Story = {
  args: { agents: [{ ...CLAUDE, authenticated: false }, CODEX, OPENCODE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await Promise.all([
      ...['Claude Code', 'Codex', 'OpenCode'].map((name) =>
        expect(canvas.getByText(name)).toBeVisible(),
      ),
      // Each of them is signed in by its own command, which is what the page offers a reader
      // whose machine is not signed in. Hemera types none of these lines for anybody.
      ...['claude auth login', 'codex login', 'opencode auth login'].map((login) =>
        expect(canvas.getByText(login)).toBeVisible(),
      ),
    ])
    expect(canvasElement.textContent ?? '').not.toMatch(
      /agentclientprotocol|claude-agent-acp|codex-acp/,
    )
  },
}

/**
 * While the tool is running, the press is busy and every other one is closed.
 *
 * Two tools write the same global prefix, so a second update started beside the first is a race
 * nobody watching the page could see.
 */
export const UpdatingClosesTheOtherPresses: Story = {
  args: { updating: 'claude' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pressed = canvas.getByRole('button', { name: /update to 2\.0\.35/i })
    // Base UI says a button cannot be pressed with `aria-disabled`, which is what keeps it
    // focusable and its state readable; the attribute is what says so.
    await expect(pressed).toHaveAttribute('aria-disabled', 'true')
    await expect(within(pressed).getByRole('status')).toBeVisible()
  },
}

/** What the tool said, whole: it is the reason an update refused, and not a sentence written here. */
export const TheToolsOwnWords: Story = {
  args: { output: { claude: SAID } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const said = canvas.getByLabelText('What the update of Claude Code said')
    await expect(said).toBeVisible()
    await expect(said).toHaveTextContent('updated 1 package')
  },
}

/** The three with an installed version and no published one: asked and not yet answered, or
    answered with nothing. */
const UNANSWERED = [
  { ...CLAUDE, latest: null },
  { ...CODEX, latest: null },
  { ...OPENCODE, latest: null },
]

/** The registries are being asked: each found agent says so rather than showing a version. */
export const Checking: Story = {
  args: { checked: false, agents: UNANSWERED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Checking…')).toHaveLength(2)
    await expect(canvas.getByText(/Asking each registry what it published/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
  },
}

/**
 * The registries were asked and answered nothing — offline, down, or not published there: the
 * line says the check failed, which is not the same as being up to date, and offers nothing.
 */
export const CouldNotCheck: Story = {
  args: { checked: true, agents: UNANSWERED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Could not check')).toHaveLength(2)
    await expect(canvas.queryByText('Up to date')).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
  },
}

/**
 * An agent that runs with Hemera's tools only says so in one line, folded on what it still
 * keeps out of Hemera's sight — its own sources, which Hemera names and does not read.
 */
export const RunsWithHemerasToolsOnly: Story = {
  args: { agents: [CLAUDE, OPENCODE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Two folds with the same line, told apart by whoever does not see the header above each.
    await expect(
      canvas.getByRole('button', { name: "OpenCode: Runs with Hemera's tools only" }),
    ).toBeInTheDocument()
    const fold = canvas.getByRole('button', { name: "Claude Code: Runs with Hemera's tools only" })
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText(/~\/\.claude\.json/)).not.toBeInTheDocument()

    await userEvent.click(fold)
    await expect(await canvas.findByText(/~\/\.claude\.json still load/)).toBeVisible()
  },
}

/**
 * An agent that cannot run here: one line, `Not available here`, folded on the adapter's reason,
 * which is read in full once it is asked for and not before.
 */
export const NotAvailableHere: Story = {
  args: { agents: [CODEX] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fold = canvas.getByRole('button', { name: 'Codex: Not available here' })
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText(/apply_patch/)).not.toBeInTheDocument()

    await userEvent.click(fold)
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expect(await canvas.findByText(/apply_patch has no configuration key/)).toBeVisible()
  },
}

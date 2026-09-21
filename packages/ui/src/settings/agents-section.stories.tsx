import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AgentsSection } from './agents-section.tsx'

/**
 * The three answers this machine can give about an agent, drawn in the shape of the other
 * settings sections: what is installed, what its registry published, and the one press that
 * moves it.
 *
 * Every story keeps the same three agents so that the section reads the way a reader would find
 * it: Claude Code found with an update waiting, Codex installed but not signed in, OpenCode
 * absent with the one command that would get it.
 */
const CLAUDE = {
  id: 'claude',
  name: 'Claude Code',
  found: true,
  version: '2.0.31',
  authenticated: true,
  installHint: 'npm i -g @anthropic-ai/claude-code',
  installer: 'npm',
  latest: '2.0.35',
} as const

const CODEX = {
  id: 'codex',
  name: 'Codex',
  found: true,
  version: '0.9.4',
  authenticated: false,
  installHint: 'codex login',
  installer: 'pnpm',
  latest: '0.9.4',
} as const

const OPENCODE = {
  id: 'opencode',
  name: 'OpenCode',
  found: false,
  version: null,
  authenticated: false,
  installHint: 'bun add -g opencode-ai',
  installer: 'unknown',
  latest: null,
} as const

/** What an installer says when it has moved a package, kept as the tool wrote it. */
const SAID = `added 1 package in 4s

+ @anthropic-ai/claude-code@2.0.35
updated 1 package and audited 2 packages in 3.812s`

const meta = {
  title: 'Components/AgentsSection',
  component: AgentsSection,
  tags: ['autodocs', 'new'],
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
 * The two versions side by side, and the one agent whose registry answered something newer.
 *
 * Claude Code is found at 2.0.31 and its registry published 2.0.35, so it is the only one
 * offered an update; Codex is on the version it published, so nothing is offered for it.
 */
export const AnUpdateIsPublishedAndOffered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2.0.31')).toBeVisible()
    await expect(canvas.getByText('2.0.35')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /update to 2\.0\.35/i })).toBeVisible()
    // Both found agents say which tool put them there, and the absent one says what to run.
    await expect(canvas.getAllByText('Installed with')).toHaveLength(2)
    await expect(canvas.getAllByRole('button', { name: /update to/i })).toHaveLength(1)
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

/** An agent already on what its registry published is offered nothing at all. */
export const UpToDateOffersNothing: Story = {
  args: { agents: [{ ...CLAUDE, version: '2.0.35' }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
    await expect(canvas.getAllByText('2.0.35')).toHaveLength(2)
  },
}

/** An agent that is missing says how to get it, rather than being silently absent. */
export const MissingSaysHowToGetIt: Story = {
  args: { agents: [OPENCODE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('not on this machine')).toBeVisible()
    await expect(canvas.getByText('bun add -g opencode-ai')).toBeVisible()
    // The registries were asked and this one answered nothing, which is not the same absence
    // as never having asked, and neither of them is a version.
    await expect(canvas.getByText('no registry answered')).toBeVisible()
    await expect(canvas.queryByText('unknown')).not.toBeInTheDocument()
  },
}

/** Installed and not signed in, which is the reader's to fix and nobody else's. */
export const InstalledButNotSignedIn: Story = {
  args: { agents: [CODEX] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Not signed in')).toBeVisible()
    // The version it is on, and the one its registry published: the same number twice.
    await expect(canvas.getAllByText('0.9.4')).toHaveLength(2)
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

/** The three, before anything has asked a registry: an installed version and no published one,
    which is the same absence for an agent this machine has and one it does not. */
const UNASKED = [
  { ...CLAUDE, latest: null },
  { ...CODEX, latest: null },
  { ...OPENCODE, latest: null },
]

/** Nothing has asked the registries yet: the section says so rather than showing a version. */
export const NobodyAskedTheRegistriesYet: Story = {
  args: { checked: false, agents: UNASKED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('not asked yet')).toHaveLength(3)
    await expect(canvas.getByText(/Asking each registry what it published/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument()
  },
}

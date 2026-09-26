import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { COMMAND_TYPES } from './command-type.ts'
import { RunDetails } from './run-details.tsx'

/**
 * What a run shows of itself (D8-06, D8-07).
 *
 * The `test` command of `atlas`, run by the agent in the Workspace `login-form`: the line it ran,
 * the folder inside that Workspace, the variables it was given — `PORT` at the Workspace's own
 * `3001` — its output and its exit code.
 */
const TEST_OUTPUT = [
  '> atlas-api@0.4.0 test',
  '> vitest run',
  '',
  ' ✓ src/login.test.ts (4 tests) 12ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  4 passed (4)',
].join('\n')

const FOLDER = '/home/someone/.hemera/workspaces/atlas/login-form/sources/api'

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/RunDetails',
  component: RunDetails,
  parameters: { layout: 'padded' },
  args: {
    name: 'test',
    type: 'test',
    workspace: 'login-form',
    folder: FOLDER,
    line: 'pnpm vitest run',
    environment: { PORT: '3001', NODE_ENV: 'test' },
    output: TEST_OUTPUT,
    state: 'exited',
    exitCode: 0,
    startedBy: 'agent',
  },
  argTypes: {
    name: { control: 'text', description: 'The name the catalogue keeps it under.' },
    type: {
      control: 'select',
      options: COMMAND_TYPES,
      description: 'What the command is for, which fixes its icon.',
    },
    workspace: { control: 'text', description: 'The Workspace the run is in.' },
    folder: { control: 'text', description: 'The folder it ran in, as the system writes it.' },
    line: { control: 'text', description: "The line as it was run: the machine's own variant." },
    environment: { control: 'object', description: 'The variables Hemera gave the run.' },
    output: { control: 'text', description: 'Everything it wrote.' },
    state: {
      control: 'inline-radio',
      options: ['running', 'exited', 'failed', 'stopped'],
      description: 'Where the run stands.',
    },
    exitCode: { control: 'number', description: 'What it exited with, once it is over.' },
    url: { control: 'text', description: 'The address its output published.' },
    readiness: {
      control: 'inline-radio',
      options: ['starting', 'ready', 'unanswered'],
      description: 'Whether the address has answered yet.',
    },
    startedBy: {
      control: 'inline-radio',
      options: ['agent', 'user'],
      description: 'Who started it.',
    },
    className: { control: false, description: 'Where the details sit; never how they look.' },
  },
} satisfies Meta<typeof RunDetails>

export default meta

type Story = StoryObj<typeof meta>

type PlayContext = Parameters<NonNullable<Story['play']>>[0]

// Scenario: "A run shows what it ran"
async function aRunShowsWhatItRan({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  await expect(canvas.getByText('pnpm vitest run')).toBeVisible()
  await expect(canvas.getByText(FOLDER)).toBeVisible()
  const variables = within(canvas.getByRole('list', { name: 'Variables given' }))
  const port = within(variables.getByText('PORT').closest('li')!)
  await expect(port.getByText('3001')).toBeVisible()
  // Sorted by key: `NODE_ENV` before `PORT`, whatever order they were merged in.
  const keys = variables.getAllByRole('listitem').map((item) => item.firstChild?.textContent)
  await expect(keys).toEqual(['NODE_ENV', 'PORT'])
  await expect(canvas.getByRole('log', { name: 'Output of test' })).toHaveTextContent(
    'Tests 4 passed (4)',
  )
  await expect(canvas.getByText('Exited 0')).toBeVisible()
}

// Scenario: "A command's folder resolves inside the Workspace"
async function aCommandsFolderResolvesInsideTheWorkspace({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  // The run says which Workspace it is in, and its folder is that Workspace's `sources/api`.
  await expect(canvas.getByText('login-form')).toBeVisible()
  await expect(canvas.getByText(FOLDER)).toBeVisible()
  await expect(FOLDER.endsWith('/login-form/sources/api')).toBe(true)
}

/** A `test` command that ended clean: everything it was given and everything it gave back. */
export const Ended: Story = {
  play: async (context) => {
    await aRunShowsWhatItRan(context)
    await aCommandsFolderResolvesInsideTheWorkspace(context)
  },
}

/** Still running: no exit code yet, and the output keeps its bottom. */
export const Running: Story = {
  args: {
    state: 'running',
    exitCode: undefined,
    output: '> atlas-api@0.4.0 test\n> vitest run\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Running')).toBeVisible()
    await expect(canvas.queryByText(/^Exited/)).toBeNull()
  },
}

/** A check that failed: the exit code is the proof, and the output is the answer. */
export const Failed: Story = {
  args: {
    state: 'failed',
    exitCode: 1,
    output: `${TEST_OUTPUT.replace('4 passed (4)', '1 failed | 3 passed (4)')}\n`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Exited 1')).toBeVisible()
  },
}

// Scenario: "The machine runs its own variant"
async function theMachineRunsItsOwnVariant({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  await expect(canvas.getByText('scripts\\seed.cmd')).toBeVisible()
  await expect(canvas.queryByText('./scripts/seed.sh')).toBeNull()
}

/** A `script` run on Windows: the line shown is the Windows line it ran, not the default one. */
export const WindowsVariant: Story = {
  args: {
    name: 'seed',
    type: 'script',
    folder:
      'C:\\Users\\someone\\AppData\\Local\\Hemera\\workspaces\\atlas\\login-form\\sources\\api',
    line: 'scripts\\seed.cmd',
    environment: { DATABASE_URL: 'postgres://localhost:5432/atlas', PORT: '3001' },
    output: 'Seeded 12 users.\r\n',
    startedBy: 'user',
  },
  play: theMachineRunsItsOwnVariant,
}

/** A `serve` run that published an address and has answered on it. */
export const Serving: Story = {
  args: {
    name: 'dev',
    type: 'serve',
    folder: '/home/someone/.hemera/workspaces/atlas/login-form/sources/front',
    line: 'pnpm dev',
    environment: { PORT: '3001' },
    output: 'vite v7.1.4\n\n  Local:   http://localhost:3001/\n',
    state: 'running',
    exitCode: undefined,
    url: 'http://localhost:3001/',
    readiness: 'ready',
    startedBy: 'user',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('http://localhost:3001/')).toBeVisible()
    await expect(canvas.getByText('ready')).toBeVisible()
  },
}
